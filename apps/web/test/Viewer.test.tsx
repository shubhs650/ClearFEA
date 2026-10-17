// SPDX-License-Identifier: AGPL-3.0-or-later
import { emptySimulationSpec, type GeometryView, type RunView } from "@clearfea/spec";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Deformation, hiddenFacesOf, toggleFace, Viewer } from "../src/layout/Viewer";
import type { DisplayMesh } from "../src/viewer/displayMesh";
import type { CameraView, Cut, Marker, ModelViewEvents } from "../src/viewer/ModelView";
import type { Quantity } from "../src/viewer/resultFields";
import { readFixture } from "./fixtures";
import { encodeFields, twoFacesFields } from "./resultFiles";
import { boxMesh } from "./volumeBox";

// jsdom has no WebGL, so the three.js scene is replaced by a stand-in that records what the
// viewer asks of it and lets a test play the part of the mouse.
type Recorded = {
  events: ModelViewEvents;
  meshes: DisplayMesh[];
  bands: (Float32Array | undefined)[];
  selections: number[][];
  /** Each setEdges call: the edge tags drawn, or null for none. */
  edges: (number[] | null)[];
  edgeSelections: number[][];
  /** Each setMarkers call. */
  markers: Marker[][];
  /** Each setCut call (M3.4). */
  cuts: (Cut | null)[];
  /** Each setHiddenFaces call (M3.6). */
  hiddenFaces: number[][];
  /** Each setCamera call (M3.6). */
  cameras: CameraView[];
  /** Each setSwing call (M6.2). */
  swings: (Float32Array | null)[];
  disposed: boolean;
};

const scene = vi.hoisted(() => ({ instances: [] as Recorded[], failToStart: false }));

vi.mock("../src/viewer/ModelView", () => ({
  ModelView: class {
    record: Recorded;
    constructor(_host: HTMLElement, events: ModelViewEvents) {
      if (scene.failToStart) throw new Error("no WebGL");
      this.record = { events, meshes: [], bands: [], selections: [], edges: [], edgeSelections: [], markers: [], cuts: [], hiddenFaces: [], cameras: [], swings: [], disposed: false };
      scene.instances.push(this.record);
    }
    setMesh(mesh: DisplayMesh, _edges?: string, _keep?: boolean, bands?: Float32Array) {
      this.record.meshes.push(mesh);
      this.record.bands.push(bands);
    }
    setSelection(tags: ReadonlySet<number>) {
      this.record.selections.push([...tags]);
    }
    setEdges(edges: { tag: number }[] | null) {
      this.record.edges.push(edges === null ? null : edges.map((e) => e.tag));
    }
    setEdgeSelection(tags: ReadonlySet<number>) {
      this.record.edgeSelections.push([...tags]);
    }
    setMarkers(markers: Marker[]) {
      this.record.markers.push(markers);
    }
    // A recolouring counts as the latest bands drawn.
    setBands(bands: Float32Array) {
      this.record.bands.push(bands);
    }
    setCut(cut: Cut | null) {
      this.record.cuts.push(cut);
    }
    setSwing(swing: Float32Array | null) {
      this.record.swings.push(swing);
    }
    setHiddenFaces(tags: ReadonlySet<number>) {
      this.record.hiddenFaces.push([...tags].sort((a, b) => a - b));
    }
    cameraView(): CameraView {
      return { position: [0.3, 0.2, 0.4], target: [0.05, 0.025, 0.01] };
    }
    setCamera(camera: CameraView) {
      this.record.cameras.push(camera);
    }
    resetView() {}
    dispose() {
      this.record.disposed = true;
    }
  },
}));

const display = readFixture("display-two-faces.bin");

const topology = {
  version: 1,
  size: 0.1136,
  bbox: [0, 0, 0, 0.1, 0.05, 0.02],
  unit: {
    declared: "SI_UNIT(.MILLI.,.METRE.)",
    detectedUnit: "mm",
    readingFactor: 0.001,
    problem: null,
  },
  scaling: 1,
  software: { gmsh: "4.15.2", occt: "7.9.0" },
  bodies: [{ tag: 1, faces: [3, 7], volume: 0.0001 }],
  faces: [3, 7].map((tag) => ({
    tag,
    type: tag === 3 ? "plane" : "cylinder",
    gmshType: tag === 3 ? "Plane" : "Cylinder",
    area: 0.005,
    centroid: [0.05, 0.025, 0],
    bbox: [0, 0, 0, 0.1, 0.05, 0],
    bodies: [1],
  })),
};

function geometry(overrides: Partial<GeometryView> = {}): GeometryView {
  return {
    id: "g1",
    name: "bracket.step",
    sizeBytes: 1000,
    status: "ready",
    problem: null,
    declaredUnit: "SI_UNIT(.MILLI.,.METRE.)",
    detectedUnit: "mm",
    unitProblem: null,
    readingFactor: 0.001,
    scaling: 1,
    confirmedUnit: "mm",
    unitLocked: false,
    bodyCount: 1,
    faceCount: 2,
    size: 0.1136,
    bbox: [0, 0, 0, 0.1, 0.05, 0.02],
    createdAt: "2026-10-14T12:00:00.000Z",
    ...overrides,
  };
}

type Reply = { status: number; json?: unknown; bytes?: ArrayBuffer };

function serve(routes: Record<string, Reply>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const reply = routes[String(input)];
    if (reply === undefined) throw new Error(`Unexpected request ${String(input)}`);
    const body = reply.bytes ?? (reply.json === undefined ? null : JSON.stringify(reply.json));
    return new Response(body, { status: reply.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const shown = {
  "/api/geometries/g1/display": { status: 200, bytes: display },
  "/api/geometries/g1/topology": { status: 200, json: topology },
};

/** The viewer with its selection held in state, as the app holds it. */
function Harness({ view }: { view: GeometryView | null }) {
  const [selection, setSelection] = useState<ReadonlySet<number>>(new Set());
  return (
    <Viewer
      geometry={view}
      selection={selection}
      onSelectionChange={setSelection}
      onSignedOut={() => {}}
    />
  );
}

beforeEach(() => {
  scene.instances.length = 0;
  scene.failToStart = false;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("viewer", () => {
  it("asks for an upload when there is no geometry", () => {
    render(<Harness view={null} />);
    expect(screen.getByText("Upload a STEP file to see the model here.")).toBeTruthy();
  });

  it("waits for the import before fetching anything", () => {
    const fetchMock = serve({});
    render(<Harness view={geometry({ status: "importing" })} />);
    expect(screen.getByText(/Importing the file/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("draws the display mesh once it and the topology have loaded", async () => {
    serve(shown);
    render(<Harness view={geometry()} />);
    expect(await screen.findByText(/Click a face to select it/)).toBeTruthy();
    const view = scene.instances[0];
    // The scene is given the mesh in an effect, which can run just after the text appears.
    await vi.waitFor(() => expect(view?.meshes).toHaveLength(1));
    expect(view?.meshes[0]?.faces.map((f) => f.tag)).toEqual([3, 7]);
  });

  it("shows the face under the pointer with its surface type and area", async () => {
    serve(shown);
    render(<Harness view={geometry()} />);
    await screen.findByText(/Click a face/);
    const view = scene.instances[0];
    act(() => view?.events.onHover(7));
    // The area, 0.005 m², in the default system's area unit.
    expect(screen.getByText("Face 7, cylinder, 5000 mm²")).toBeTruthy();
    act(() => view?.events.onHover(null));
    expect(screen.queryByText(/^Face 7/)).toBeNull();
  });

  it("adds a clicked face to the selection, removes it on a second click, clears on Escape", async () => {
    serve(shown);
    render(<Harness view={geometry()} />);
    await screen.findByText(/Click a face/);
    const view = scene.instances[0];
    act(() => view?.events.onPick(7));
    act(() => view?.events.onPick(3));
    expect(screen.getByText("2 faces selected: 3, 7")).toBeTruthy();
    expect(view?.selections.at(-1)?.sort()).toEqual([3, 7]);
    act(() => view?.events.onPick(7));
    expect(screen.getByText("1 face selected: 3")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByText(/Click a face to select it/)).toBeTruthy();
    expect(view?.selections.at(-1)).toEqual([]);
  });

  it("clears the selection with the Clear button", async () => {
    serve(shown);
    render(<Harness view={geometry()} />);
    await screen.findByText(/Click a face/);
    act(() => scene.instances[0]?.events.onPick(3));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText(/Click a face to select it/)).toBeTruthy();
  });

  it("shows the API's own reason when the mesh cannot be fetched", async () => {
    serve({
      "/api/geometries/g1/display": {
        status: 500,
        json: { error: "The display.bin of this geometry is missing from storage. Upload the file again." },
      },
      "/api/geometries/g1/topology": { status: 200, json: topology },
    });
    render(<Harness view={geometry()} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/missing from storage/);
  });

  it("says the mesh is damaged when the file does not parse", async () => {
    serve({ ...shown, "/api/geometries/g1/display": { status: 200, bytes: new ArrayBuffer(30) } });
    render(<Harness view={geometry()} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/display mesh .* is damaged/);
  });

  it("explains what to do when the browser cannot start WebGL", () => {
    scene.failToStart = true;
    render(<Harness view={null} />);
    expect(screen.getByText(/could not start WebGL/)).toBeTruthy();
  });

  it("reloads the mesh after a re-import at another unit", async () => {
    const fetchMock = serve(shown);
    const { rerender } = render(<Harness view={geometry()} />);
    await screen.findByText(/Click a face/);
    rerender(<Harness view={geometry({ scaling: 25.4, confirmedUnit: "in" })} />);
    await vi.waitFor(() => expect(scene.instances[0]?.meshes).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("frees the scene when it unmounts", () => {
    const { unmount } = render(<Harness view={null} />);
    unmount();
    expect(scene.instances[0]?.disposed).toBe(true);
  });
});

describe("toggleFace", () => {
  it("adds a missing face and removes a present one without changing the input", () => {
    const start = new Set([1]);
    expect([...toggleFace(start, 2)]).toEqual([1, 2]);
    expect([...toggleFace(start, 1)]).toEqual([]);
    expect([...start]).toEqual([1]);
  });
});

const succeeded: RunView = {
  id: "r1",
  simulationId: "s1",
  meshId: "m1",
  spec: emptySimulationSpec("g1", topology),
  mesh: { size: { value: 5, unit: "mm" }, order: 2, nodeCount: 7108, elementCount: 4000 },
  software: { clearfea: "0.0.0+d9d394b", deckFormat: 1, calculix: "2.21", gmsh: "4.15.2", occt: "7.9.0" },
  files: [],
  machine: { size: "local", ratePerHour: 1_000_000 },
  estimate: null,
  cost: null,
  status: "succeeded",
  stage: null,
  progress: null,
  problem: null,
  result: null,
  createdAt: "2026-10-15T12:00:00.000Z",
  finishedAt: "2026-10-15T12:01:00.000Z",
};

const results = {
  "/api/runs/r1/surface": { status: 200, bytes: display },
  "/api/runs/r1/fields": { status: 200, bytes: twoFacesFields() },
  "/api/geometries/g1/topology": { status: 200, json: topology },
};

const UNITS = { length: "mm", pressure: "MPa", strain: "mm/mm", ratio: "1" };

function ResultHarness({ quantity, deformation }: { quantity: Quantity; deformation: Deformation }) {
  const [selection, setSelection] = useState<ReadonlySet<number>>(new Set());
  return (
    <Viewer
      geometry={geometry()}
      result={{ run: succeeded, quantity, deformation, units: UNITS, mode: 1, animate: false }}
      selection={selection}
      onSelectionChange={setSelection}
      onSignedOut={() => {}}
    />
  );
}

describe("result view", () => {
  it("colours the run's surface in bands of von Mises stress with a legend in MPa", async () => {
    serve(results);
    render(<ResultHarness quantity="vonMises" deformation="undeformed" />);
    const legend = await screen.findByLabelText("Legend");
    expect(legend.textContent).toContain("Von Mises stress (MPa)");
    // Nine bands of 10 MPa from 0 to 90, largest first.
    const rows = [...legend.querySelectorAll("li")].map((li) => li.textContent);
    expect(rows[0]).toBe("80 to 90");
    expect(rows[8]).toBe("0 to 10");
    expect(legend.textContent).toContain("Undeformed shape");
    expect(legend.textContent).not.toMatch(/pass|fail|complian/i);
    const view = scene.instances[0];
    await vi.waitFor(() => expect(view?.bands.at(-1)).toBeDefined());
    // Vertex v carries v * 15 MPa, so its band coordinate is v / 6.
    const coordinates = [...(view?.bands.at(-1) ?? [])];
    expect(coordinates).toEqual([0, 1, 2, 3, 4, 5, 6].map((v) => Math.fround(v / 6)));
    // Undeformed: positions as in the surface file.
    expect(view?.meshes.at(-1)?.positions).toEqual(new Float32Array(readPositions()));
    // While results show, the face selection bar gives way to the legend.
    expect(screen.queryByLabelText("Selected faces")).toBeNull();
  });

  it("draws displacement on the shape deformed at true scale or exaggerated", async () => {
    serve(results);
    const { rerender } = render(<ResultHarness quantity="displacement" deformation="true" />);
    const legend = await screen.findByLabelText("Legend");
    expect(legend.textContent).toContain("Displacement magnitude (mm)");
    expect([...legend.querySelectorAll("li")][0]?.textContent).toBe("0.5333 to 0.6");
    expect(legend.textContent).toContain("Deformed shape, true scale");
    const view = scene.instances[0];
    const base = readPositions();
    await vi.waitFor(() => expect(view?.meshes.at(-1)?.positions[3]).toBeCloseTo((base[3] ?? 0) + 1e-4, 6));
    // The model is about 0.11 m across and moves at most 0.6 mm: 5 percent is about 9, so x5.
    rerender(<ResultHarness quantity="displacement" deformation="auto" />);
    await screen.findByText("Deformed shape, scale ×5");
    await vi.waitFor(() => expect(view?.meshes.at(-1)?.positions[3]).toBeCloseTo((base[3] ?? 0) + 5e-4, 6));
  });

  it("draws a stress or strain component and a principal stress, signed, in display units", async () => {
    serve(results);
    const { rerender } = render(<ResultHarness quantity="stressXY" deformation="undeformed" />);
    const legend = await screen.findByLabelText("Legend");
    expect(legend.textContent).toContain("Shear stress τxy (MPa)");
    // Vertex v carries -v MPa: nine bands from -6 to 0, largest first.
    const rows = () => [...legend.querySelectorAll("li")].map((li) => li.textContent);
    expect(rows()[0]).toBe("-0.6667 to 0");
    expect(rows()[8]).toBe("-6 to -5.333");
    const view = scene.instances[0];
    await vi.waitFor(() => expect(view?.bands.at(-1)).toBeDefined());
    // The most negative value is at vertex 6, so the band coordinates fall with the index.
    expect([...(view?.bands.at(-1) ?? [])]).toEqual([6, 5, 4, 3, 2, 1, 0].map((v) => Math.fround(v / 6)));
    rerender(<ResultHarness quantity="principal1" deformation="undeformed" />);
    await vi.waitFor(() => expect(legend.textContent).toContain("Maximum principal stress σ1 (MPa)"));
    expect(rows()[0]).toBe("53.33 to 60");
    rerender(<ResultHarness quantity="strainXY" deformation="undeformed" />);
    await vi.waitFor(() => expect(legend.textContent).toContain("Shear strain εxy (γxy / 2) (mm/mm)"));
    expect(rows()[0]).toBe("0.0001067 to 0.00012");
  });

  it("says a run solved before M3.1 has no components, and still draws von Mises", async () => {
    serve({ ...results, "/api/runs/r1/fields": { status: 200, bytes: twoFacesFields({ before31: true }) } });
    const { rerender } = render(<ResultHarness quantity="strainXX" deformation="auto" />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "This run was solved before ClearFEA kept stress components, principal stresses and strains, so it has no normal strain εxx. Run the simulation again to see it.",
    );
    rerender(<ResultHarness quantity="vonMises" deformation="auto" />);
    expect((await screen.findByLabelText("Legend")).textContent).toContain("Von Mises stress (MPa)");
  });

  it("draws the safety factor with the smallest values red, without a unit, and notes the cap", async () => {
    serve({ ...results, "/api/runs/r1/fields": { status: 200, bytes: twoFacesFields({ safety: true }) } });
    render(<ResultHarness quantity="safetyFactor" deformation="undeformed" />);
    const legend = await screen.findByLabelText("Legend");
    expect(legend.querySelector(".viewer-legend-title")?.textContent).toBe("Safety factor against yield");
    const rows = [...legend.querySelectorAll("li")];
    expect(rows[0]?.textContent).toBe("13.64 to 15");
    expect(rows[8]?.textContent).toBe("2.778 to 4.136");
    // The smallest band (bottom row) is red, the largest blue.
    expect(rows[8]?.querySelector("span")?.getAttribute("style")).toContain("rgb(255, 0, 0)");
    expect(rows[0]?.querySelector("span")?.getAttribute("style")).toContain("rgb(0, 0, 255)");
    expect(legend.textContent).toContain("Factors of 15 and more are shown as 15");
    expect(legend.textContent).not.toMatch(/pass|fail|complian|safe\b/i);
    const view = scene.instances[0];
    await vi.waitFor(() => expect(view?.markers.at(-1)).toHaveLength(2));
    expect(view?.markers.at(-1)).toEqual([
      { vertex: 0, kind: "max", text: "Max 15" },
      { vertex: 6, kind: "min", text: "Min 2.778" },
    ]);
    // Reversed bands: the smallest factor (vertex 6) sits at the red end, coordinate 1.
    const coordinates = [...(view?.bands.at(-1) ?? [])];
    expect(coordinates[6]).toBe(1);
    expect(coordinates[0]).toBe(0);
  });

  it("says why a run has no safety factor", async () => {
    serve(results);
    render(<ResultHarness quantity="safetyFactor" deformation="auto" />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "This run has no safety factor against yield. It needs a yield strength for every material, and runs solved before ClearFEA worked it out have none. Enter the yield strength under Materials and run the simulation again.",
    );
  });

  it("marks the smallest and largest value of the quantity shown, and hides the marks on request", async () => {
    serve(results);
    const { rerender } = render(<ResultHarness quantity="vonMises" deformation="undeformed" />);
    await screen.findByLabelText("Legend");
    const view = scene.instances[0];
    await vi.waitFor(() => expect(view?.markers.at(-1)).toHaveLength(2));
    expect(view?.markers.at(-1)).toEqual([
      { vertex: 6, kind: "max", text: "Max 90 MPa" },
      { vertex: 0, kind: "min", text: "Min 0 MPa" },
    ]);
    // τxy falls with the vertex index, so its largest value is at vertex 0.
    rerender(<ResultHarness quantity="stressXY" deformation="undeformed" />);
    await vi.waitFor(() => expect(view?.markers.at(-1)?.[0]).toEqual({ vertex: 0, kind: "max", text: "Max 0 MPa" }));
    expect(view?.markers.at(-1)?.[1]).toEqual({ vertex: 6, kind: "min", text: "Min -6 MPa" });
    fireEvent.click(screen.getByLabelText("Min and max"));
    await vi.waitFor(() => expect(view?.markers.at(-1)).toEqual([]));
  });

  it("probes the node clicked, lists it with its value and position, and clears the probes", async () => {
    serve(results);
    const { rerender } = render(<ResultHarness quantity="vonMises" deformation="auto" />);
    await screen.findByLabelText("Legend");
    const probes = screen.getByLabelText("Probes");
    expect(probes.textContent).toBe("Click the model to probe the value at the nearest node.");
    const view = scene.instances[0];
    act(() => view?.events.onProbe?.(4));
    act(() => view?.events.onProbe?.(2));
    // Vertex v carries v * 15 MPa; the position is the undeformed one, in mm.
    const where = (v: number) => readPositions().slice(v * 3, v * 3 + 3).map((x) => Number((x * 1000).toPrecision(4)));
    const rows = () => [...probes.querySelectorAll("li")].map((li) => li.textContent);
    expect(rows()).toEqual([`1: 60 MPa at (${where(4).join(", ")}) mm`, `2: 30 MPa at (${where(2).join(", ")}) mm`]);
    await vi.waitFor(() => expect(view?.markers.at(-1)?.slice(2)).toEqual([
      { vertex: 4, kind: "probe", text: "1: 60 MPa" },
      { vertex: 2, kind: "probe", text: "2: 30 MPa" },
    ]));
    // The probes follow the quantity shown.
    rerender(<ResultHarness quantity="stressXX" deformation="auto" />);
    await vi.waitFor(() => expect(rows()[0]).toMatch(/^1: 40 MPa at/));
    // A second click on a probed node removes its probe; Clear probes removes the rest.
    act(() => view?.events.onProbe?.(4));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatch(/^1: 20 MPa at/);
    fireEvent.click(screen.getByRole("button", { name: "Clear probes" }));
    expect(probes.textContent).toMatch(/^Click the model to probe/);
    expect(probes.textContent).not.toMatch(/pass|fail|complian/i);
  });

  it("cuts the model across x and colours the section from the values at every node", async () => {
    // A 1 m cube with von Mises 200 MPa per metre of x at every node, and no displacement.
    const cube = boxMesh(2);
    const view0 = new DataView(cube);
    const nodes = view0.getUint32(12, true);
    const x = (n: number) => view0.getFloat64(32 + n * 24, true);
    serve({
      ...results,
      "/api/runs/r1/mesh": { status: 200, bytes: cube },
      "/api/runs/r1/nodes?field=displacement": {
        status: 200,
        bytes: encodeFields(nodes, [{ name: "displacement", kind: "length", components: 3, values: new Array(nodes * 3).fill(0) }]),
      },
      "/api/runs/r1/nodes?field=vonMises": {
        status: 200,
        bytes: encodeFields(nodes, [
          { name: "vonMises", kind: "pressure", components: 1, values: Array.from({ length: nodes }, (_, n) => 200e6 * x(n)) },
        ]),
      },
    });
    render(<ResultHarness quantity="vonMises" deformation="auto" />);
    await screen.findByLabelText("Legend");
    const view = scene.instances[0];
    fireEvent.click(screen.getByLabelText("Cut plane"));
    const panel = screen.getByLabelText("Cut plane", { selector: "section" });
    await vi.waitFor(() => expect(panel.textContent).toContain("Cuts 24 elements."));
    expect(panel.textContent).toContain("x = 500 mm");
    const cut = view?.cuts.at(-1);
    expect(cut?.plane).toEqual({ normal: [1, 0, 0], offset: 0.5 });
    // The section is the cube's 1 m² cross-section at x = 0.5 m, where von Mises is 100 MPa,
    // above the surface's 90 MPa: the legend and the max marker now reach it.
    expect(cut?.positions.filter((_, i) => i % 3 === 0).every((value) => Math.abs(value - 0.5) < 1e-6)).toBe(true);
    expect([...(cut?.coordinates ?? [])].every((u) => u === 1)).toBe(true);
    const rows = [...screen.getByLabelText("Legend").querySelectorAll("li")].map((li) => li.textContent);
    expect(rows[0]).toBe("88.89 to 100");
    await vi.waitFor(() => expect(view?.markers.at(-1)?.[0]).toMatchObject({ kind: "max", text: "Max 100 MPa", onSection: true }));
    // Across z, then turned round, then off again.
    fireEvent.click(screen.getByLabelText("z"));
    await vi.waitFor(() => expect(view?.cuts.at(-1)?.plane).toEqual({ normal: [0, 0, 1], offset: 0.5 }));
    fireEvent.click(screen.getByLabelText("Keep the other side"));
    await vi.waitFor(() => expect(view?.cuts.at(-1)?.plane).toEqual({ normal: [0, 0, -1], offset: -0.5 }));
    fireEvent.change(screen.getByRole("slider"), { target: { value: "50" } });
    await vi.waitFor(() => expect(view?.cuts.at(-1)?.plane).toEqual({ normal: [0, 0, -1], offset: -0.25 }));
    fireEvent.click(screen.getByLabelText("Cut plane", { selector: "input" }));
    await vi.waitFor(() => expect(view?.cuts.at(-1)).toBeNull());
    expect(screen.queryByLabelText("Cut plane", { selector: "section" })).toBeNull();
  });

  it("says to run again when the run has no values inside the body", async () => {
    const before = "This run was solved before ClearFEA kept results inside the body, so it cannot be cut. Run the simulation again to use a cut plane.";
    serve({
      ...results,
      "/api/runs/r1/mesh": { status: 200, bytes: boxMesh(1) },
      "/api/runs/r1/nodes?field=displacement": { status: 404, json: { error: before } },
      "/api/runs/r1/nodes?field=vonMises": { status: 404, json: { error: before } },
    });
    render(<ResultHarness quantity="vonMises" deformation="auto" />);
    await screen.findByLabelText("Legend");
    fireEvent.click(screen.getByLabelText("Cut plane"));
    const panel = screen.getByLabelText("Cut plane", { selector: "section" });
    await vi.waitFor(() => expect(panel.textContent).toContain(before));
    expect(scene.instances[0]?.cuts.at(-1) ?? null).toBeNull();
  });

  it("says the run's files do not match when their vertex counts differ", async () => {
    serve({ ...results, "/api/runs/r1/fields": { status: 200, bytes: readFixture("result-fields-three-vertices.bin") } });
    render(<ResultHarness quantity="vonMises" deformation="auto" />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/do not belong together/);
  });
});

function readPositions(): number[] {
  const view = new DataView(display);
  const vertices = view.getUint32(8, true);
  return Array.from({ length: vertices * 3 }, (_, i) => view.getFloat32(20 + i * 4, true));
}

/** The test geometry made of two bodies: face 3 (vertices 0 to 2) is body 1's and face 7
 * (vertices 3 to 6) body 2's. */
const twoBodies = {
  ...topology,
  bodies: [
    { tag: 1, faces: [3], volume: 0.00005 },
    { tag: 2, faces: [7], volume: 0.00005 },
  ],
  faces: topology.faces.map((face) => ({ ...face, bodies: [face.tag === 3 ? 1 : 2] })),
};

const savedView = {
  id: "v1",
  name: "Body 1 from below",
  settings: {
    camera: { position: [0.1, -0.3, 0.05], target: [0.05, 0.025, 0] },
    hiddenBodies: [2],
    result: { quantity: "principal1", deformation: "true", extremes: false, cut: null },
  },
  updatedAt: "2026-10-16T05:00:00.000Z",
};

/** The viewer of an open simulation, with the result choice held in state as the app holds it. */
function ViewsHarness({ onResult }: { onResult?: boolean }) {
  const [selection, setSelection] = useState<ReadonlySet<number>>(new Set());
  const [choice, setChoice] = useState<{ quantity: Quantity; deformation: Deformation; mode: number }>({
    quantity: "vonMises",
    deformation: "undeformed",
    mode: 1,
  });
  return (
    <>
      <span data-testid="choice">{`${choice.quantity} ${choice.deformation}`}</span>
      <Viewer
        geometry={geometry({ bodyCount: 2 })}
        result={onResult ? { run: succeeded, ...choice, units: UNITS, animate: false } : null}
        selection={selection}
        onSelectionChange={setSelection}
        simulationId="s1"
        onResultChange={setChoice}
        onSignedOut={() => {}}
      />
    </>
  );
}

describe("hiding bodies (M3.6)", () => {
  it("is offered only for a geometry of more than one body", async () => {
    serve(shown);
    render(<Harness view={geometry()} />);
    await screen.findByText(/Click a face/);
    expect(screen.queryByRole("button", { name: /^Bodies/ })).toBeNull();
  });

  it("names bodies by their part names in the list and on hover (M4.1)", async () => {
    const named = { ...twoBodies, bodies: [twoBodies.bodies[0], { ...twoBodies.bodies[1], name: "Lug" }] };
    serve({ ...shown, "/api/geometries/g1/topology": { status: 200, json: named } });
    render(<Harness view={geometry({ bodyCount: 2 })} />);
    await screen.findByText(/Click a face/);
    fireEvent.click(screen.getByRole("button", { name: "Bodies" }));
    expect(screen.getByRole("checkbox", { name: "Body 1" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Lug" })).toBeTruthy();
    act(() => scene.instances[0]?.events.onHover(7));
    expect(screen.getByText(/^Face 7, .*, Lug$/)).toBeTruthy();
  });

  it("hides a body's faces, keeps the last body shown, and shows all again", async () => {
    serve({ ...shown, "/api/geometries/g1/topology": { status: 200, json: twoBodies } });
    render(<Harness view={geometry({ bodyCount: 2 })} />);
    await screen.findByText(/Click a face/);
    const view = scene.instances[0];
    fireEvent.click(screen.getByRole("button", { name: "Bodies" }));
    const panel = screen.getByLabelText("Bodies");
    const body = (tag: number) => screen.getByRole("checkbox", { name: `Body ${tag}` }) as HTMLInputElement;
    expect(body(1).checked && body(2).checked).toBe(true);
    fireEvent.click(body(2));
    await vi.waitFor(() => expect(view?.hiddenFaces.at(-1)).toEqual([7]));
    expect(screen.getByRole("button", { name: "Bodies (1 of 2)" })).toBeTruthy();
    // Body 1 is the last one shown, so it cannot be hidden.
    expect(body(1).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    await vi.waitFor(() => expect(view?.hiddenFaces.at(-1)).toEqual([]));
    expect(panel.isConnected).toBe(true);
  });

  it("keeps a face two bodies share while either is shown", () => {
    const faces = new Map([
      [1, { ...twoBodies.faces[0], tag: 1, bodies: [1] }],
      [2, { ...twoBodies.faces[0], tag: 2, bodies: [1, 2] }],
      [3, { ...twoBodies.faces[0], tag: 3, bodies: [2] }],
    ] as const);
    expect([...hiddenFacesOf(faces as never, new Set([2]))]).toEqual([3]);
    expect([...hiddenFacesOf(faces as never, new Set([1, 2]))]).toEqual([1, 2, 3]);
    expect([...hiddenFacesOf(faces as never, new Set())]).toEqual([]);
  });

  it("spans the legend and the min and max over the bodies shown", async () => {
    serve({ ...results, "/api/geometries/g1/topology": { status: 200, json: twoBodies } });
    serveViews();
    render(<ViewsHarness onResult />);
    const legend = await screen.findByLabelText("Legend");
    fireEvent.click(screen.getByRole("button", { name: "Bodies" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Body 2" }));
    // Body 1's face carries 0, 15 and 30 MPa.
    await vi.waitFor(() => expect(legend.querySelector("li")?.textContent).toBe("26.67 to 30"));
    const view = scene.instances[0];
    await vi.waitFor(() =>
      expect(view?.markers.at(-1)).toEqual([
        { vertex: 2, kind: "max", text: "Max 30 MPa" },
        { vertex: 0, kind: "min", text: "Min 0 MPa" },
      ]),
    );
  });
});

/** Serves the simulation's views; returns what was posted. */
function serveViews(views: unknown[] = []) {
  const posted: unknown[] = [];
  const before = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/simulations/s1/views") {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { name: string; settings: unknown };
          posted.push(body);
          return new Response(JSON.stringify({ view: { id: "v2", ...body, updatedAt: "2026-10-16T05:01:00.000Z" } }), {
            status: 201,
          });
        }
        return new Response(JSON.stringify({ views }), { status: 200 });
      }
      if (String(input) === "/api/simulations/s1/views/v1" && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return before(input, init);
    }),
  );
  return posted;
}

describe("saved views (M3.6)", () => {
  it("saves the camera, the hidden bodies and the result display under a name", async () => {
    serve({ ...results, "/api/geometries/g1/topology": { status: 200, json: twoBodies } });
    const posted = serveViews();
    render(<ViewsHarness onResult />);
    await screen.findByLabelText("Legend");
    fireEvent.click(screen.getByRole("button", { name: "Bodies" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Body 2" }));
    fireEvent.click(screen.getByLabelText("Cut plane"));
    fireEvent.click(screen.getByRole("button", { name: "Views" }));
    expect(await screen.findByText(/No saved views yet/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("View name"), { target: { value: " Cut, body 1 " } });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));
    expect(await screen.findByText('Saved the view "Cut, body 1".')).toBeTruthy();
    expect(posted).toEqual([
      {
        name: "Cut, body 1",
        settings: {
          camera: { position: [0.3, 0.2, 0.4], target: [0.05, 0.025, 0.01] },
          hiddenBodies: [2],
          result: { quantity: "vonMises", deformation: "undeformed", extremes: true, cut: { axis: 0, at: 0.5, flipped: false } },
        },
      },
    ]);
    expect(screen.getByRole("button", { name: "Cut, body 1" })).toBeTruthy();
  });

  it("brings a view back: camera and hidden bodies, and on results what they show", async () => {
    serve({ ...results, "/api/geometries/g1/topology": { status: 200, json: twoBodies } });
    serveViews([savedView]);
    render(<ViewsHarness onResult />);
    await screen.findByLabelText("Legend");
    fireEvent.click(screen.getByRole("button", { name: "Views" }));
    fireEvent.click(await screen.findByRole("button", { name: "Body 1 from below" }));
    const view = scene.instances[0];
    expect(view?.cameras.at(-1)).toEqual(savedView.settings.camera);
    await vi.waitFor(() => expect(view?.hiddenFaces.at(-1)).toEqual([7]));
    expect(screen.getByTestId("choice").textContent).toBe("principal1 true");
    expect((screen.getByLabelText("Min and max") as HTMLInputElement).checked).toBe(false);
  });

  it("brings back only the camera and hidden bodies on the geometry", async () => {
    serve({ ...shown, "/api/geometries/g1/topology": { status: 200, json: twoBodies } });
    serveViews([savedView]);
    render(<ViewsHarness />);
    await screen.findByText(/Click a face/);
    fireEvent.click(screen.getByRole("button", { name: "Views" }));
    fireEvent.click(await screen.findByRole("button", { name: "Body 1 from below" }));
    await vi.waitFor(() => expect(scene.instances[0]?.hiddenFaces.at(-1)).toEqual([7]));
    expect(screen.getByTestId("choice").textContent).toBe("vonMises undeformed");
  });

  it("deletes a view", async () => {
    serve(shown);
    serveViews([savedView]);
    render(<ViewsHarness />);
    await screen.findByText(/Click a face/);
    fireEvent.click(screen.getByRole("button", { name: "Views" }));
    fireEvent.click(await screen.findByRole("button", { name: 'Delete the view "Body 1 from below"' }));
    expect(await screen.findByText('Deleted the view "Body 1 from below".')).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Body 1 from below" })).toBeNull();
  });
});

describe("thermal results (M5.1)", () => {
  const thermalRun: RunView = {
    ...succeeded,
    spec: { ...succeeded.spec, analysis: "steady_thermal" },
  };
  // Vertex v is at 20 + 10 v °C: 20 °C to 80 °C over the seven vertices.
  const temperatures = encodeFields(7, [
    { name: "temperature", kind: "temperature", components: 1, values: Array.from({ length: 7 }, (_, v) => 293.15 + 10 * v) },
  ]);
  const thermal = {
    ...results,
    "/api/runs/r1/fields": { status: 200, bytes: temperatures },
  };

  function ThermalHarness({ unit }: { unit: string }) {
    const [selection, setSelection] = useState<ReadonlySet<number>>(new Set());
    return (
      <Viewer
        geometry={geometry()}
        result={{
          run: thermalRun,
          quantity: "temperature",
          deformation: "undeformed",
          units: { ...UNITS, temperature: unit },
          mode: 1,
          animate: false,
        }}
        selection={selection}
        onSelectionChange={setSelection}
        onSignedOut={() => {}}
      />
    );
  }

  it("draws the temperature undeformed, with the legend, markers and probes converted with the offset", async () => {
    serve(thermal);
    const { rerender } = render(<ThermalHarness unit="°C" />);
    const legend = await screen.findByLabelText("Legend");
    expect(legend.textContent).toContain("Temperature (°C)");
    expect(legend.textContent).not.toMatch(/shape/i);
    const rows = [...legend.querySelectorAll("li")].map((li) => li.textContent);
    expect(rows[0]).toBe("73.33 to 80");
    expect(rows[8]).toBe("20 to 26.67");
    const view = scene.instances[0];
    // No displacement: the surface is drawn where the file has it.
    await vi.waitFor(() => expect(view?.meshes.at(-1)?.positions).toEqual(new Float32Array(readPositions())));
    await vi.waitFor(() =>
      expect(view?.markers.at(-1)?.slice(0, 2)).toMatchObject([
        { kind: "max", text: "Max 80 °C" },
        { kind: "min", text: "Min 20 °C" },
      ]),
    );
    act(() => view?.events.onProbe?.(4));
    const probes = screen.getByLabelText("Probes");
    expect(probes.querySelector("li")?.textContent).toMatch(/^1: 60 °C at/);
    rerender(<ThermalHarness unit="°F" />);
    await vi.waitFor(() => expect(probes.querySelector("li")?.textContent).toMatch(/^1: 140 °F at/));
    expect(screen.getByLabelText("Legend").textContent).toContain("68 to 80");
    rerender(<ThermalHarness unit="K" />);
    await vi.waitFor(() => expect(probes.querySelector("li")?.textContent).toMatch(/^1: 333.1 K at/));
  });

  it("cuts a thermal run asking for the temperature at every node and nothing else", async () => {
    const cube = boxMesh(2);
    const view0 = new DataView(cube);
    const nodes = view0.getUint32(12, true);
    const x = (n: number) => view0.getFloat64(32 + n * 24, true);
    // 0 °C at x = 0 to 100 °C at x = 1 m; a request for displacement is a test error.
    const fetchMock = serve({
      ...thermal,
      "/api/runs/r1/mesh": { status: 200, bytes: cube },
      "/api/runs/r1/nodes?field=temperature": {
        status: 200,
        bytes: encodeFields(nodes, [
          { name: "temperature", kind: "temperature", components: 1, values: Array.from({ length: nodes }, (_, n) => 273.15 + 100 * x(n)) },
        ]),
      },
    });
    render(<ThermalHarness unit="°C" />);
    await screen.findByLabelText("Legend");
    fireEvent.click(screen.getByLabelText("Cut plane"));
    const panel = screen.getByLabelText("Cut plane", { selector: "section" });
    await vi.waitFor(() => expect(panel.textContent).toContain("Cuts 24 elements."));
    const view = scene.instances[0];
    // The section at x = 0.5 m is at 50 °C, inside the surface's 20 °C to 80 °C.
    await vi.waitFor(() => expect(view?.cuts.at(-1)?.plane).toEqual({ normal: [1, 0, 0], offset: 0.5 }));
    expect(fetchMock.mock.calls.map(([path]) => String(path))).not.toContain("/api/runs/r1/nodes?field=displacement");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("modal results (M6.2)", () => {
  const modalRun: RunView = {
    ...succeeded,
    spec: { ...succeeded.spec, analysis: "modal", modes: 2 },
    result: { nodes: 7, frequencies: [10, 20], software: { calculix: "2.21" } },
  };
  // Mode 1 moves along z, vertex v by v / 6 (1 at vertex 6); mode 2 along y, -1 at vertex 0.
  const shapes = encodeFields(7, [
    { name: "mode1", kind: "ratio", components: 3, values: Array.from({ length: 21 }, (_, i) => (i % 3 === 2 ? Math.floor(i / 3) / 6 : 0)) },
    {
      name: "mode2",
      kind: "ratio",
      components: 3,
      values: Array.from({ length: 21 }, (_, i) => (i % 3 === 1 ? (Math.floor(i / 3) - 6) / 6 : 0)),
    },
  ]);
  const modal = { ...results, "/api/runs/r1/fields": { status: 200, bytes: shapes } };

  function ModalHarness({ mode, deformation = "auto", animate = false }: { mode: number; deformation?: Deformation; animate?: boolean }) {
    const [selection, setSelection] = useState<ReadonlySet<number>>(new Set());
    return (
      <Viewer
        geometry={geometry()}
        result={{ run: modalRun, quantity: "modeShape", deformation, units: UNITS, mode, animate }}
        selection={selection}
        onSelectionChange={setSelection}
        onSignedOut={() => {}}
      />
    );
  }

  /** The diagonal of the box around the run's surface, in metres. */
  function size(): number {
    const p = readPositions();
    const span = [0, 1, 2].map((axis) => {
      const values = p.filter((_, i) => i % 3 === axis);
      return Math.max(...values) - Math.min(...values);
    });
    return Math.hypot(...span);
  }

  it("draws the chosen mode's shape, coloured by its relative displacement, at a tenth of the model's size", async () => {
    serve(modal);
    const { rerender } = render(<ModalHarness mode={1} />);
    const legend = await screen.findByLabelText("Legend");
    expect(legend.textContent).toContain("Mode shape, relative displacement");
    expect(legend.textContent).not.toContain("(1)");
    expect(legend.textContent).toContain("largest displacement drawn at 10 % of the model's size");
    const view = scene.instances[0];
    const scale = 0.1 * size();
    const rest = readPositions();
    await vi.waitFor(() => expect(view?.meshes.at(-1)?.positions[20]).toBeCloseTo((rest[20] ?? 0) + scale, 6));
    expect(view?.meshes.at(-1)?.positions[1]).toBeCloseTo(rest[1] ?? 0, 6);
    await vi.waitFor(() => expect(view?.markers.at(-1)?.[0]).toMatchObject({ kind: "max", text: "Max 1", vertex: 6 }));
    // Mode 2 moves along y; its largest displacement is at vertex 0.
    rerender(<ModalHarness mode={2} />);
    await vi.waitFor(() => expect(view?.meshes.at(-1)?.positions[1]).toBeCloseTo((rest[1] ?? 0) - scale, 6));
    expect(view?.meshes.at(-1)?.positions[20]).toBeCloseTo(rest[20] ?? 0, 6);
    // Undeformed, the shape is only the colours.
    rerender(<ModalHarness mode={2} deformation="undeformed" />);
    await vi.waitFor(() => expect(view?.meshes.at(-1)?.positions).toEqual(new Float32Array(rest)));
    expect(screen.getByLabelText("Legend").textContent).toContain("Undeformed shape");
  });

  it("swings the mode shape drawn when asked, and stops", async () => {
    serve(modal);
    const { rerender } = render(<ModalHarness mode={1} animate />);
    await screen.findByLabelText("Legend");
    const view = scene.instances[0];
    const scale = 0.1 * size();
    await vi.waitFor(() => expect(view?.swings.at(-1)).toBeInstanceOf(Float32Array));
    const swing = view?.swings.at(-1);
    expect(swing?.[20]).toBeCloseTo(scale, 6);
    expect(swing?.[19]).toBe(0);
    rerender(<ModalHarness mode={1} />);
    await vi.waitFor(() => expect(view?.swings.at(-1)).toBeNull());
  });

  it("says a modal run solved before M6.2 has no mode shapes", async () => {
    serve({ ...results, "/api/runs/r1/fields": { status: 200, bytes: encodeFields(7, []) } });
    render(<ModalHarness mode={1} />);
    expect((await screen.findByRole("alert")).textContent).toContain("solved before ClearFEA kept mode shapes");
  });

  it("cuts a modal run asking for the shown mode's values at every node and nothing else", async () => {
    const cube = boxMesh(2);
    const nodes = new DataView(cube).getUint32(12, true);
    const fetchMock = serve({
      ...modal,
      "/api/runs/r1/mesh": { status: 200, bytes: cube },
      "/api/runs/r1/nodes?field=mode2": {
        status: 200,
        bytes: encodeFields(nodes, [
          { name: "mode2", kind: "ratio", components: 3, values: Array.from({ length: 3 * nodes }, (_, i) => (i % 3 === 1 ? 0.5 : 0)) },
        ]),
      },
    });
    render(<ModalHarness mode={2} />);
    await screen.findByLabelText("Legend");
    fireEvent.click(screen.getByLabelText("Cut plane"));
    const panel = screen.getByLabelText("Cut plane", { selector: "section" });
    await vi.waitFor(() => expect(panel.textContent).toContain("Cuts 24 elements."));
    const asked = fetchMock.mock.calls.map(([path]) => String(path));
    expect(asked.filter((path) => path.includes("nodes?"))).toEqual(["/api/runs/r1/nodes?field=mode2"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
