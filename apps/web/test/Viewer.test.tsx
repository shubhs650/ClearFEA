// SPDX-License-Identifier: AGPL-3.0-or-later
import { emptySimulationSpec, type GeometryView, type RunView } from "@clearfea/spec";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Deformation, toggleFace, Viewer } from "../src/layout/Viewer";
import type { DisplayMesh } from "../src/viewer/displayMesh";
import type { ModelViewEvents } from "../src/viewer/ModelView";
import { readFixture } from "./fixtures";
import { twoFacesFields } from "./resultFiles";

// jsdom has no WebGL, so the three.js scene is replaced by a stand-in that records what the
// viewer asks of it and lets a test play the part of the mouse.
type Recorded = {
  events: ModelViewEvents;
  meshes: DisplayMesh[];
  bands: (Float32Array | undefined)[];
  selections: number[][];
  disposed: boolean;
};

const scene = vi.hoisted(() => ({ instances: [] as Recorded[], failToStart: false }));

vi.mock("../src/viewer/ModelView", () => ({
  ModelView: class {
    record: Recorded;
    constructor(_host: HTMLElement, events: ModelViewEvents) {
      if (scene.failToStart) throw new Error("no WebGL");
      this.record = { events, meshes: [], bands: [], selections: [], disposed: false };
      scene.instances.push(this.record);
    }
    setMesh(mesh: DisplayMesh, _edges?: string, _keep?: boolean, bands?: Float32Array) {
      this.record.meshes.push(mesh);
      this.record.bands.push(bands);
    }
    setSelection(tags: ReadonlySet<number>) {
      this.record.selections.push([...tags]);
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

  it("shows the face under the pointer with its surface type", async () => {
    serve(shown);
    render(<Harness view={geometry()} />);
    await screen.findByText(/Click a face/);
    const view = scene.instances[0];
    act(() => view?.events.onHover(7));
    expect(screen.getByText("Face 7, cylinder")).toBeTruthy();
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
  status: "succeeded",
  stage: null,
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

const UNITS = { length: "mm", pressure: "MPa" };

function ResultHarness({ quantity, deformation }: { quantity: "displacement" | "vonMises"; deformation: Deformation }) {
  const [selection, setSelection] = useState<ReadonlySet<number>>(new Set());
  return (
    <Viewer
      geometry={geometry()}
      result={{ run: succeeded, quantity, deformation, units: UNITS }}
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
