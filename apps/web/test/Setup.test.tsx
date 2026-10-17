// SPDX-License-Identifier: AGPL-3.0-or-later
// The setup flow in the whole app (M1.5): start a simulation on a ready geometry, add a
// material, a fixed support and a pressure from the tree, and see each edit saved.

import {
  type GeometryView,
  type IsotropicMaterial,
  type MeshQuality,
  type MeshView,
  elementLimitProblem,
  ITERATIVE_ACCURACY_NOTE,
  materialLibrary,
  maxElements,
  type RunEstimate,
  type RunView,
  type SimulationSpec,
  type SimulationView,
  type SolveResult,
} from "@clearfea/spec";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { ModelViewEvents } from "../src/viewer/ModelView";
import { readFixture } from "./fixtures";
import { encodeFields, twoFacesFields } from "./resultFiles";

// jsdom has no WebGL: a stand-in scene lets the test pick faces and see the selection.
const scene = vi.hoisted(() => ({
  events: [] as ModelViewEvents[],
  selections: [] as number[][],
  edges: [] as string[],
  // Each setEdges call (M2.8): the geometry edge tags drawn, or null for none.
  geometryEdges: [] as (number[] | null)[],
  edgeSelections: [] as number[][],
}));

vi.mock("../src/viewer/ModelView", () => ({
  ModelView: class {
    constructor(_host: HTMLElement, events: ModelViewEvents) {
      scene.events.push(events);
    }
    setMesh(_mesh: unknown, edges = "outlines") {
      scene.edges.push(edges);
    }
    setSelection(tags: ReadonlySet<number>) {
      scene.selections.push([...tags].sort((a, b) => a - b));
    }
    setEdges(edges: { tag: number }[] | null) {
      scene.geometryEdges.push(edges === null ? null : edges.map((e) => e.tag));
    }
    setEdgeSelection(tags: ReadonlySet<number>) {
      scene.edgeSelections.push([...tags].sort((a, b) => a - b));
    }
    setMarkers() {}
    setBands() {}
    setCut() {}
    setSwing() {}
    setHiddenFaces() {}
    cameraView() {
      return { position: [1, 1, 1], target: [0, 0, 0] };
    }
    setCamera() {}
    resetView() {}
    dispose() {}
  },
}));

const display = readFixture("display-two-faces.bin");

const topology = {
  version: 1,
  size: 0.1136,
  bbox: [0, 0, 0, 0.1, 0.05, 0.02],
  unit: { declared: "SI_UNIT(.MILLI.,.METRE.)", detectedUnit: "mm", readingFactor: 0.001, problem: null },
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
  edges: [5, 6].map((tag) => ({
    tag,
    length: 0.1,
    bbox: [0, 0, 0, 0.1, 0, 0],
    faces: [3, 7],
    points: [0, 0, 0, 0.1, 0, 0],
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

const emptySpec: SimulationSpec = {
  version: 1,
  analysis: "linear_static",
  geometryId: "g1",
  bodies: [{ tag: 1, material: null }],
  materials: [],
  supports: [],
  loads: [],
  mesh: { size: null },
};

function simulation(spec: SimulationSpec = emptySpec): SimulationView {
  return {
    id: "s1",
    name: "Static structural",
    geometryId: "g1",
    spec,
    createdAt: "2026-10-15T12:00:00.000Z",
    updatedAt: "2026-10-15T12:00:00.000Z",
  };
}

type Reply = { status: number; json?: unknown; bytes?: ArrayBuffer };
type Route = Reply | ((init?: RequestInit) => Reply);

/** Answers fetch calls by "METHOD /path"; anything not listed is a test error. */
function serve(routes: Record<string, Route>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    const route = routes[key];
    if (route === undefined) throw new Error(`Unexpected request ${key}`);
    const reply = typeof route === "function" ? route(init) : route;
    const body = reply.bytes ?? (reply.json === undefined ? null : JSON.stringify(reply.json));
    return new Response(body, { status: reply.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const GiB = 2 ** 30;

/** An estimate for the test mesh's 7,108 nodes, in the API's shape. */
const ESTIMATE: RunEstimate = {
  estimator: 1,
  nodes: 7108,
  memoryBytes: 95 * 2 ** 20,
  seconds: 3,
  extrapolated: false,
  sizes: [
    { size: "small", cores: 2, memoryBytes: 8 * GiB, ratePerHour: 500_000, cost: 417, fits: true },
    { size: "medium", cores: 4, memoryBytes: 16 * GiB, ratePerHour: 1_000_000, cost: 833, fits: true },
  ],
  recommended: "small",
};

/** The routes of a signed-in user with one ready geometry and the given simulations. */
function routes(simulations: SimulationView[], extra: Record<string, Route> = {}): Record<string, Route> {
  return {
    "GET /api/health": { status: 200, json: { status: "ok", database: "ok", storage: "ok" } },
    "GET /api/session": { status: 200, json: { user: { id: "a", login: "alice", name: "Alice" } } },
    "GET /api/jobs": { status: 200, json: { jobs: [] } },
    "GET /api/geometries": { status: 200, json: { geometries: [geometry()] } },
    "GET /api/geometries/g1/display": { status: 200, bytes: display },
    "GET /api/geometries/g1/topology": { status: 200, json: topology },
    "GET /api/simulations?geometryId=g1": { status: 200, json: { simulations } },
    "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: null } },
    "GET /api/simulations/s1/runs": { status: 200, json: { runs: [] } },
    "GET /api/simulations/s1/estimate?solver=pastix&analysis=linear_static": { status: 200, json: { estimate: ESTIMATE } },
    "GET /api/project": { status: 200, json: { project: { id: "p1", name: "My project", unitSystem: "metric-mm" } } },
    "GET /api/materials": { status: 200, json: { library: materialLibrary.materials, custom: [] } },
    ...extra,
  };
}

/** Records every spec the app saves and answers as the API would. */
function saves() {
  const sent: SimulationSpec[] = [];
  const route = (init?: RequestInit): Reply => {
    const spec = JSON.parse(String(init?.body)) as SimulationSpec;
    sent.push(spec);
    return { status: 200, json: { simulation: simulation(spec) } };
  };
  return { sent, route };
}

const tree = () => within(screen.getByRole("navigation", { name: "Simulation tree" }));
const settings = () => within(screen.getByRole("complementary", { name: "Settings" }));

beforeEach(() => {
  scene.events.length = 0;
  scene.selections.length = 0;
  scene.edges.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("setup tree", () => {
  it("starts a setup on a ready geometry and then shows its unit as locked", async () => {
    const fetchMock = serve(
      routes([], {
        "POST /api/simulations": { status: 201, json: { simulation: simulation() } },
        "GET /api/geometries/g1": { status: 200, json: { geometry: geometry({ unitLocked: true }) } },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Start setup" }));
    expect(await screen.findByRole("button", { name: "Materials, incomplete" })).toBeTruthy();
    expect(tree().getByRole("button", { name: "Supports, incomplete" })).toBeTruthy();
    expect(tree().getByRole("button", { name: "Loads, incomplete" })).toBeTruthy();
    expect(tree().getByRole("button", { name: "Geometry, complete" })).toBeTruthy();
    expect(await screen.findByText(/is locked, because a simulation uses this geometry/)).toBeTruthy();
    const create = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(create?.[1]?.body))).toEqual({ geometryId: "g1", name: "Static structural" });
  });

  it("asks for the unit before setup can start", async () => {
    serve({
      ...routes([]),
      "GET /api/geometries": { status: 200, json: { geometries: [geometry({ status: "unconfirmed", confirmedUnit: null })] } },
    });
    render(<App />);
    expect(await screen.findByText("Confirm the geometry's length unit to start the setup.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start setup" })).toBeNull();
  });

  it("adds a material, saves its values and marks it complete", async () => {
    const { sent, route } = saves();
    serve(routes([simulation()], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Materials, incomplete" }));
    expect(settings().getByText("Add a material.")).toBeTruthy();
    fireEvent.click(settings().getByRole("button", { name: "Add an empty material" }));
    expect(tree().getByRole("button", { name: "Material 1, incomplete" })).toBeTruthy();
    expect(settings().getByRole("checkbox", { name: "Body 1" })).toHaveProperty("checked", true);

    // The project's system (millimetres, newtons, megapascals) gives the unit offered first.
    expect(settings().getByLabelText("Young's modulus unit")).toHaveProperty("value", "MPa");
    fireEvent.change(settings().getByLabelText("Young's modulus"), { target: { value: "200000" } });
    fireEvent.change(settings().getByLabelText("Poisson's ratio"), { target: { value: "0.3" } });
    expect(await screen.findByRole("button", { name: "Material 1, complete" })).toBeTruthy();
    expect(tree().getByRole("button", { name: "Materials, complete" })).toBeTruthy();
    await waitFor(() => expect(sent.at(-1)?.materials[0]?.poissonsRatio).toBe(0.3));
    expect(sent.at(-1)?.materials).toEqual([
      {
        id: "material-1",
        name: "Material 1",
        model: "isotropic_elastic",
        youngsModulus: { value: 200000, unit: "MPa" },
        poissonsRatio: 0.3,
        density: null,
        thermalExpansion: null,
        yieldStrength: null,
      },
    ]);
    expect(sent.at(-1)?.bodies).toEqual([{ tag: 1, material: "material-1" }]);
    expect(await tree().findByText("All changes saved.")).toBeTruthy();
  });

  it("keeps an out-of-range Poisson's ratio out of the spec and says why", async () => {
    const { sent, route } = saves();
    serve(routes([simulation()], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Materials, incomplete" }));
    fireEvent.click(settings().getByRole("button", { name: "Add an empty material" }));
    fireEvent.change(settings().getByLabelText("Poisson's ratio"), { target: { value: "0.7" } });
    expect(settings().getByText("Enter a value above -1 and below 0.5.")).toBeTruthy();
    fireEvent.change(settings().getByLabelText("Young's modulus"), { target: { value: "-5" } });
    expect(settings().getByText("Enter a value greater than 0.")).toBeTruthy();
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(sent.at(-1)?.materials[0]).toMatchObject({ youngsModulus: null, poissonsRatio: null });
  });

  it("adds a library material with its values as published and its source (M2.9)", async () => {
    const { sent, route } = saves();
    serve(routes([simulation()], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Materials, incomplete" }));
    const library = within(await settings().findByRole("region", { name: "Material library" }));
    fireEvent.change(library.getByLabelText("Material"), { target: { value: "lib-al-6061" } });
    // Shown in the project's units (MPa), with the value as the source prints it.
    const values = within(library.getByLabelText("Values of Aluminium alloy 6061"));
    expect(values.getByText("68260 MPa (given as 9900 ksi)")).toBeTruthy();
    expect(values.getByText("0.33")).toBeTruthy();
    expect(values.getByText("Not given; enter it for a temperature change.")).toBeTruthy();
    expect(values.getByText(/^MIL-HDBK-5G \(1 November 1994\), Table 3\.6\.2\.0\(b1\), page 3-244/)).toBeTruthy();

    fireEvent.click(library.getByRole("button", { name: "Add this material" }));
    expect(await tree().findByRole("button", { name: "Aluminium alloy 6061, complete" })).toBeTruthy();
    const original = materialLibrary.materials.find((m) => m.id === "lib-al-6061");
    await waitFor(() => expect(sent.at(-1)?.materials).toEqual([{ ...original, id: "material-1" }]));
    expect(sent.at(-1)?.bodies).toEqual([{ tag: 1, material: "material-1" }]);
    expect(settings().getByLabelText("Young's modulus unit")).toHaveProperty("value", "ksi");
    expect(settings().getByText(/^Values from MIL-HDBK-5G/)).toBeTruthy();

    // A changed value no longer matches the source, so the source is dropped; a new name is not a new value.
    fireEvent.change(settings().getByLabelText("Name"), { target: { value: "Bracket 6061" } });
    await waitFor(() => expect(sent.at(-1)?.materials[0]?.name).toBe("Bracket 6061"));
    expect(sent.at(-1)?.materials[0]?.source).toBe(original?.source);
    fireEvent.change(settings().getByLabelText("Poisson's ratio"), { target: { value: "0.34" } });
    await waitFor(() => expect(sent.at(-1)?.materials[0]?.poissonsRatio).toBe(0.34));
    expect(sent.at(-1)?.materials[0]).not.toHaveProperty("source");
    expect(settings().queryByText(/^Values from/)).toBeNull();
  });

  it("saves a material to the user's materials, offers it first, and deletes it (M2.9)", async () => {
    const steel: IsotropicMaterial = {
      id: "steel",
      name: "Bracket steel",
      model: "isotropic_elastic",
      youngsModulus: { value: 205, unit: "GPa" },
      poissonsRatio: 0.29,
      density: null,
      thermalExpansion: null,
    };
    const posted: unknown[] = [];
    const fetchMock = serve(
      routes([simulation({ ...emptySpec, materials: [steel], bodies: [{ tag: 1, material: "steel" }] })], {
        "POST /api/materials": (init) => {
          posted.push(JSON.parse(String(init?.body)));
          return { status: 201, json: { material: { ...steel, id: "c1" } } };
        },
        "DELETE /api/materials/c1": { status: 204 },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Bracket steel, complete" }));
    fireEvent.click(settings().getByRole("button", { name: "Save to my materials" }));
    expect(await settings().findByText('Saved "Bracket steel" to your materials. You can add it to any simulation.')).toBeTruthy();
    expect(posted).toEqual([{ material: steel }]);

    fireEvent.click(tree().getByRole("button", { name: "Materials, complete" }));
    const library = within(settings().getByRole("region", { name: "Material library" }));
    expect(library.getByLabelText("Material")).toHaveProperty("value", "c1");
    expect(library.getByRole("group", { name: "Your materials" })).toBeTruthy();
    expect(within(library.getByLabelText("Values of Bracket steel")).getByText("205000 MPa (given as 205 GPa)")).toBeTruthy();
    fireEvent.click(library.getByRole("button", { name: "Delete from your materials" }));
    expect(
      await library.findByText('Deleted "Bracket steel" from your materials. Simulations that use it keep their copy.'),
    ).toBeTruthy();
    expect(fetchMock.mock.calls.some(([path, init]) => path === "/api/materials/c1" && init?.method === "DELETE")).toBe(true);
    expect(library.queryByRole("group", { name: "Your materials" })).toBeNull();
    // The simulation's own copy stays.
    expect(tree().getByRole("button", { name: "Bracket steel, complete" })).toBeTruthy();
  });

  it("offers saving only once the modulus and Poisson's ratio are entered (M2.9)", async () => {
    const { route } = saves();
    serve(routes([simulation()], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Materials, incomplete" }));
    fireEvent.click(settings().getByRole("button", { name: "Add an empty material" }));
    expect(settings().getByRole("button", { name: "Save to my materials" })).toHaveProperty("disabled", true);
    expect(settings().getByText("Enter Young's modulus and Poisson's ratio to save it to your materials.")).toBeTruthy();
  });

  it("lists the bodies of an assembly by part name and assigns each its material (M4.1)", async () => {
    const assembly = {
      ...topology,
      bodies: [
        { tag: 1, name: "Base plate", faces: [3], volume: 0.0001 },
        { tag: 2, faces: [7], volume: 0.0001 },
      ],
      faces: topology.faces.map((face) => ({ ...face, bodies: [face.tag === 3 ? 1 : 2] })),
    };
    const steel = { ...materialLibrary.materials[0], id: "steel" } as IsotropicMaterial;
    const aluminium = { ...materialLibrary.materials[1], id: "aluminium" } as IsotropicMaterial;
    const spec: SimulationSpec = {
      ...emptySpec,
      bodies: [
        { tag: 1, material: "steel" },
        { tag: 2, material: null },
      ],
      materials: [steel, aluminium],
    };
    const { sent, route } = saves();
    serve(
      routes([simulation(spec)], {
        "GET /api/geometries": { status: 200, json: { geometries: [geometry({ bodyCount: 2 })] } },
        "GET /api/geometries/g1/topology": { status: 200, json: assembly },
        "PUT /api/simulations/s1/spec": route,
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Bodies, incomplete" }));
    expect(tree().getByRole("button", { name: "Base plate, complete" })).toBeTruthy();
    expect(tree().getByRole("button", { name: "Body 2, incomplete" })).toBeTruthy();
    expect(settings().getByText("Pick a material for Body 2.")).toBeTruthy();
    expect(settings().getByLabelText("Material of Base plate")).toHaveProperty("value", "steel");

    fireEvent.change(settings().getByLabelText("Material of Body 2"), { target: { value: "aluminium" } });
    expect(tree().getByRole("button", { name: "Bodies, complete" })).toBeTruthy();
    await waitFor(() =>
      expect(sent.at(-1)?.bodies).toEqual([
        { tag: 1, material: "steel" },
        { tag: 2, material: "aluminium" },
      ]),
    );

    // Opening a body selects its faces in the viewer and shows its name from the file.
    fireEvent.click(tree().getByRole("button", { name: "Base plate, complete" }));
    expect(scene.selections.at(-1)).toEqual([3]);
    expect(settings().getByRole("heading", { name: "Base plate" })).toBeTruthy();
    fireEvent.change(settings().getByLabelText("Material"), { target: { value: "" } });
    expect(tree().getByRole("button", { name: "Base plate, incomplete" })).toBeTruthy();

    // The material panel names the bodies the same way.
    fireEvent.click(tree().getByRole("button", { name: `${aluminium.name}, complete` }));
    expect(settings().getByRole("checkbox", { name: /^Body 2/ })).toHaveProperty("checked", true);
    expect(settings().getByRole("checkbox", { name: /^Base plate/ })).toHaveProperty("checked", false);
  });

  it("lists the bonds between touching bodies, shows them in the viewer and saves each review (M4.2)", async () => {
    const assembly = {
      ...topology,
      bodies: [
        { tag: 1, name: "Base plate", faces: [3], volume: 0.0001 },
        { tag: 2, name: "Lug", faces: [7], volume: 0.0001 },
      ],
      faces: topology.faces.map((face) => ({ ...face, bodies: [face.tag === 3 ? 1 : 2] })),
      bondTolerance: 0.00001,
      bonds: [{ faces: [3, 7], bodies: [1, 2], area: 0.0004, gap: 0 }],
    };
    const spec: SimulationSpec = {
      ...emptySpec,
      bodies: [
        { tag: 1, material: null },
        { tag: 2, material: null },
      ],
      bonds: [{ faces: [3, 7], status: "detected" }],
    };
    const { sent, route } = saves();
    serve(
      routes([simulation(spec)], {
        "GET /api/geometries": { status: 200, json: { geometries: [geometry({ bodyCount: 2 })] } },
        "GET /api/geometries/g1/topology": { status: 200, json: assembly },
        "PUT /api/simulations/s1/spec": route,
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Bonds, incomplete" }));
    // Opening Bonds selects the faces of every tied bond.
    expect(scene.selections.at(-1)).toEqual([3, 7]);
    expect(settings().getByText(/touch within 0.01 mm are bonded/)).toBeTruthy();
    const bond = () => within(settings().getByRole("listitem", { name: "Base plate to Lug" }));
    expect(bond().getByText("Faces 3 and 7, 400 mm². Detected, tied.")).toBeTruthy();

    fireEvent.click(settings().getByRole("button", { name: "Accept the bond Base plate to Lug" }));
    expect(tree().getByRole("button", { name: "Bonds, complete" })).toBeTruthy();
    await waitFor(() => expect(sent.at(-1)?.bonds).toEqual([{ faces: [3, 7], status: "accepted" }]));

    fireEvent.click(settings().getByRole("button", { name: "Remove the bond Base plate to Lug" }));
    expect(bond().getByText("Faces 3 and 7, 400 mm². Removed, not tied.")).toBeTruthy();
    await waitFor(() => expect(sent.at(-1)?.bonds).toEqual([{ faces: [3, 7], status: "removed" }]));
    expect(settings().getByRole("button", { name: "Show every tied bond" })).toHaveProperty("disabled", true);

    fireEvent.click(settings().getByRole("button", { name: "Restore the bond Base plate to Lug" }));
    await waitFor(() => expect(sent.at(-1)?.bonds).toEqual([{ faces: [3, 7], status: "accepted" }]));

    // Showing a bond selects its two faces.
    fireEvent.click(tree().getByRole("button", { name: "Base plate, incomplete" }));
    expect(scene.selections.at(-1)).toEqual([3]);
    fireEvent.click(tree().getByRole("button", { name: "Bonds, complete" }));
    fireEvent.click(settings().getByRole("button", { name: "Show the bond Base plate to Lug, faces 3 and 7" }));
    expect(scene.selections.at(-1)).toEqual([3, 7]);
  });

  it("has no Bonds item for a single body, and says when a geometry predates bond detection", async () => {
    serve(routes([simulation()]));
    render(<App />);
    expect(await screen.findByRole("button", { name: "Materials, incomplete" })).toBeTruthy();
    expect(tree().queryByRole("button", { name: /^Bonds/ })).toBeNull();
    cleanup();

    const older = {
      ...topology,
      bodies: [
        { tag: 1, faces: [3], volume: 0.0001 },
        { tag: 2, faces: [7], volume: 0.0001 },
      ],
    };
    const spec: SimulationSpec = { ...emptySpec, bodies: [{ tag: 1, material: null }, { tag: 2, material: null }] };
    serve(
      routes([simulation(spec)], {
        "GET /api/geometries": { status: 200, json: { geometries: [geometry({ bodyCount: 2 })] } },
        "GET /api/geometries/g1/topology": { status: 200, json: older },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Bonds, complete" }));
    expect(settings().getByText(/imported before bonds were detected. Upload the STEP file again/)).toBeTruthy();
  });

  it("gives a new support the faces selected in the viewer, and shows an item's faces when opened", async () => {
    const { sent, route } = saves();
    serve(routes([simulation()], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    await screen.findByText(/Click a face to select it/);
    act(() => scene.events[0]?.onPick(3));
    fireEvent.click(tree().getByRole("button", { name: "Supports, incomplete" }));
    fireEvent.click(settings().getByRole("button", { name: "Add a fixed support" }));
    expect(tree().getByRole("button", { name: "Fixed support 1, complete" })).toBeTruthy();
    expect(settings().getByText("3")).toBeTruthy();

    // With the selection cleared, a new pressure has no faces until it is given face 7.
    fireEvent.click(tree().getByRole("button", { name: "Loads, incomplete" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(settings().getByRole("button", { name: "Add a pressure" }));
    expect(tree().getByRole("button", { name: "Pressure 1, incomplete" })).toBeTruthy();
    expect(settings().getByText(/None yet/)).toBeTruthy();
    act(() => scene.events[0]?.onPick(7));
    fireEvent.click(settings().getByRole("button", { name: "Use the selected face" }));
    fireEvent.change(settings().getByLabelText("Magnitude"), { target: { value: "2.5" } });
    expect(tree().getByRole("button", { name: "Pressure 1, complete" })).toBeTruthy();
    await waitFor(() => expect(sent.at(-1)?.loads[0]).toMatchObject({ magnitude: { value: 2.5, unit: "MPa" } }));
    expect(sent.at(-1)?.loads[0]).toMatchObject({ faces: [7] });
    expect(sent.at(-1)?.supports).toEqual([{ id: "fixed-1", type: "fixed", name: "Fixed support 1", faces: [3] }]);

    // Opening the support again selects its faces in the viewer.
    fireEvent.click(tree().getByRole("button", { name: "Fixed support 1, complete" }));
    expect(scene.selections.at(-1)).toEqual([3]);
  });

  it("adds a prescribed displacement and a frictionless support (M2.2)", async () => {
    const { sent, route } = saves();
    serve(routes([simulation()], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    await screen.findByText(/Click a face to select it/);
    act(() => scene.events[0]?.onPick(3));
    fireEvent.click(tree().getByRole("button", { name: "Supports, incomplete" }));
    fireEvent.click(settings().getByRole("button", { name: "Add a prescribed displacement" }));
    // Every component starts free, which holds nothing.
    expect(tree().getByRole("button", { name: "Prescribed displacement 1, incomplete" })).toBeTruthy();
    expect(settings().getByText("Give at least one component a value; every one is free.")).toBeTruthy();
    fireEvent.click(settings().getByLabelText("z free"));
    expect(settings().getByText("Enter the z displacement or set it free.")).toBeTruthy();
    fireEvent.change(settings().getByLabelText("z displacement"), { target: { value: "0.5" } });
    expect(tree().getByRole("button", { name: "Prescribed displacement 1, complete" })).toBeTruthy();
    await waitFor(() =>
      expect(sent.at(-1)?.supports).toEqual([
        {
          id: "displacement-1",
          type: "displacement",
          name: "Prescribed displacement 1",
          faces: [3],
          x: "free",
          y: "free",
          z: { value: 0.5, unit: "mm" },
        },
      ]),
    );

    fireEvent.click(tree().getByRole("button", { name: "Supports, complete" }));
    fireEvent.click(settings().getByRole("button", { name: "Add a frictionless support" }));
    expect(settings().getByRole("heading", { name: "Frictionless support" })).toBeTruthy();
    expect(settings().getByText(/slide in its plane/)).toBeTruthy();
    await waitFor(() =>
      expect(sent.at(-1)?.supports[1]).toEqual({
        id: "frictionless-1",
        type: "frictionless",
        name: "Frictionless support 1",
        faces: [3],
      }),
    );
  });

  it("adds an elastic support with a foundation stiffness (M2.6)", async () => {
    const { sent, route } = saves();
    serve(routes([simulation()], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    await screen.findByText(/Click a face to select it/);
    act(() => scene.events[0]?.onPick(3));
    fireEvent.click(tree().getByRole("button", { name: "Supports, incomplete" }));
    fireEvent.click(settings().getByRole("button", { name: "Add an elastic support" }));
    expect(settings().getByRole("heading", { name: "Elastic support" })).toBeTruthy();
    expect(settings().getByText(/does not stop the faces sliding/)).toBeTruthy();
    expect(tree().getByRole("button", { name: "Elastic support 1, incomplete" })).toBeTruthy();
    expect(settings().getByText("Enter the foundation stiffness.")).toBeTruthy();
    fireEvent.change(settings().getByLabelText("Foundation stiffness"), { target: { value: "20" } });
    expect(tree().getByRole("button", { name: "Elastic support 1, complete" })).toBeTruthy();
    await waitFor(() =>
      expect(sent.at(-1)?.supports).toEqual([
        {
          id: "elastic-1",
          type: "elastic",
          name: "Elastic support 1",
          faces: [3],
          stiffness: { value: 20, unit: "N/mm³" },
        },
      ]),
    );
  });

  it("adds a temperature change and asks the material for its thermal expansion (M2.7)", async () => {
    const { sent, route } = saves();
    const spec: SimulationSpec = {
      ...emptySpec,
      materials: [
        {
          id: "steel",
          name: "Steel",
          model: "isotropic_elastic",
          youngsModulus: { value: 200, unit: "GPa" },
          poissonsRatio: 0.3,
        },
      ],
      bodies: [{ tag: 1, material: "steel" }],
    };
    serve(routes([simulation(spec)], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    await screen.findByText(/Click a face to select it/);
    act(() => scene.events[0]?.onPick(3));
    fireEvent.click(tree().getByRole("button", { name: "Loads, incomplete" }));
    fireEvent.click(settings().getByRole("button", { name: "Add a temperature change" }));
    expect(settings().getByRole("heading", { name: "Temperature change" })).toBeTruthy();
    expect(settings().queryByText("Faces")).toBeNull();
    expect(settings().getByText("Enter the temperature change (negative for cooling).")).toBeTruthy();
    fireEvent.change(settings().getByLabelText("Change"), { target: { value: "-30" } });
    expect(tree().getByRole("button", { name: "Temperature change 1, complete" })).toBeTruthy();
    expect(tree().getByRole("button", { name: "Steel, incomplete" })).toBeTruthy();
    fireEvent.click(tree().getByRole("button", { name: "Steel, incomplete" }));
    expect(settings().getByText("Enter the thermal expansion; the temperature change needs it.")).toBeTruthy();
    fireEvent.change(settings().getByLabelText("Thermal expansion"), { target: { value: "12e-6" } });
    expect(tree().getByRole("button", { name: "Steel, complete" })).toBeTruthy();
    await waitFor(() =>
      expect(sent.at(-1)?.materials[0]?.thermalExpansion).toEqual({ value: 12e-6, unit: "1/°C" }),
    );
    expect(sent.at(-1)?.loads).toEqual([
      { id: "temperature-1", type: "temperature", name: "Temperature change 1", change: { value: -30, unit: "°C" } },
    ]);
  });

  it("adds a force, gravity and a centrifugal load, and asks the material for a density (M2.3)", async () => {
    const { sent, route } = saves();
    const spec: SimulationSpec = {
      ...emptySpec,
      materials: [
        {
          id: "steel",
          name: "Steel",
          model: "isotropic_elastic",
          youngsModulus: { value: 200, unit: "GPa" },
          poissonsRatio: 0.3,
        },
      ],
      bodies: [{ tag: 1, material: "steel" }],
    };
    serve(routes([simulation(spec)], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    await screen.findByText(/Click a face to select it/);
    act(() => scene.events[0]?.onPick(3));
    fireEvent.click(tree().getByRole("button", { name: "Loads, incomplete" }));
    fireEvent.click(settings().getByRole("button", { name: "Add a force" }));
    expect(settings().getByRole("heading", { name: "Force" })).toBeTruthy();
    expect(settings().getByText("Enter the x component (0 for none).")).toBeTruthy();
    for (const [axis, value] of [["x", "0"], ["y", "-2"], ["z", "0"]]) {
      fireEvent.change(settings().getByLabelText(axis as string), { target: { value } });
    }
    expect(tree().getByRole("button", { name: "Force 1, complete" })).toBeTruthy();
    await waitFor(() =>
      expect(sent.at(-1)?.loads).toEqual([
        {
          id: "force-1",
          type: "force",
          name: "Force 1",
          faces: [3],
          x: { value: 0, unit: "N" },
          y: { value: -2, unit: "N" },
          z: { value: 0, unit: "N" },
        },
      ]),
    );

    // Gravity has no faces, and makes the material ask for its density.
    fireEvent.click(tree().getByRole("button", { name: "Loads, complete" }));
    fireEvent.click(settings().getByRole("button", { name: "Add gravity" }));
    expect(settings().getByRole("heading", { name: "Gravity" })).toBeTruthy();
    expect(settings().queryByText("Faces")).toBeNull();
    for (const [axis, value] of [["x", "0"], ["y", "0"], ["z", "-9.81"]]) {
      fireEvent.change(settings().getByLabelText(axis as string), { target: { value } });
    }
    expect(tree().getByRole("button", { name: "Gravity 1, complete" })).toBeTruthy();
    expect(tree().getByRole("button", { name: "Steel, incomplete" })).toBeTruthy();
    fireEvent.click(tree().getByRole("button", { name: "Steel, incomplete" }));
    expect(settings().getByText("Enter the density; gravity and centrifugal loads need it.")).toBeTruthy();
    fireEvent.change(settings().getByLabelText("Density"), { target: { value: "7850" } });
    expect(tree().getByRole("button", { name: "Steel, complete" })).toBeTruthy();

    fireEvent.click(tree().getByRole("button", { name: "Loads, complete" }));
    fireEvent.click(settings().getByRole("button", { name: "Add a centrifugal load" }));
    expect(tree().getByRole("button", { name: "Centrifugal load 1, incomplete" })).toBeTruthy();
    fireEvent.change(settings().getByLabelText("Angular velocity"), { target: { value: "100" } });
    const fields = settings().getAllByLabelText(/^[xyz]$/);
    // Point x, y, z, then direction x, y, z.
    for (const [k, value] of ["0", "0", "0", "0", "0", "1"].entries()) {
      fireEvent.change(fields[k] as HTMLElement, { target: { value } });
    }
    expect(tree().getByRole("button", { name: "Centrifugal load 1, complete" })).toBeTruthy();
    await waitFor(() =>
      expect(sent.at(-1)?.loads[2]).toEqual({
        id: "centrifugal-1",
        type: "centrifugal",
        name: "Centrifugal load 1",
        angularVelocity: { value: 100, unit: "rpm" },
        axisPoint: { x: { value: 0, unit: "mm" }, y: { value: 0, unit: "mm" }, z: { value: 0, unit: "mm" } },
        axisDirection: { x: 0, y: 0, z: 1 },
      }),
    );
    expect(sent.at(-1)?.loads[1]).toMatchObject({ z: { value: -9.81, unit: "m/s²" } });
    expect(sent.at(-1)?.materials[0]?.density).toEqual({ value: 7850, unit: "kg/m³" });
  });

  it("adds a remote force and moment on the selected faces (M2.4)", async () => {
    const { sent, route } = saves();
    serve(routes([simulation(emptySpec)], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    await screen.findByText(/Click a face to select it/);
    act(() => scene.events[0]?.onPick(3));
    fireEvent.click(tree().getByRole("button", { name: "Loads, incomplete" }));
    fireEvent.click(settings().getByRole("button", { name: "Add a remote force and moment" }));
    expect(settings().getByRole("heading", { name: "Remote load" })).toBeTruthy();
    expect(settings().getByText("Enter the reference point.")).toBeTruthy();
    expect(settings().getByText("Enter the force (0 for none).")).toBeTruthy();
    expect(settings().getByText("Enter the moment (0 for none).")).toBeTruthy();
    const fields = settings().getAllByLabelText(/^[xyz]$/);
    // Point x, y, z, then force x, y, z, then moment x, y, z.
    for (const [k, value] of ["0", "0", "250", "0", "-500", "0", "1000", "0", "0"].entries()) {
      fireEvent.change(fields[k] as HTMLElement, { target: { value } });
    }
    expect(tree().getByRole("button", { name: "Remote load 1, complete" })).toBeTruthy();
    const mm = (value: number) => ({ value, unit: "mm" });
    const n = (value: number) => ({ value, unit: "N" });
    const nmm = (value: number) => ({ value, unit: "N·mm" });
    await waitFor(() =>
      expect(sent.at(-1)?.loads).toEqual([
        {
          id: "remote-1",
          type: "remote",
          name: "Remote load 1",
          faces: [3],
          point: { x: mm(0), y: mm(0), z: mm(250) },
          force: { x: n(0), y: n(-500), z: n(0) },
          moment: { x: nmm(1000), y: nmm(0), z: nmm(0) },
        },
      ]),
    );
  });

  it("adds a hydrostatic pressure on the selected faces (M2.5)", async () => {
    const { sent, route } = saves();
    serve(routes([simulation(emptySpec)], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    await screen.findByText(/Click a face to select it/);
    act(() => scene.events[0]?.onPick(3));
    fireEvent.click(tree().getByRole("button", { name: "Loads, incomplete" }));
    fireEvent.click(settings().getByRole("button", { name: "Add a hydrostatic pressure" }));
    expect(settings().getByRole("heading", { name: "Hydrostatic pressure" })).toBeTruthy();
    expect(settings().getByText("Enter the fluid density.")).toBeTruthy();
    expect(settings().getByText("Enter the gravity (0 for none).")).toBeTruthy();
    expect(settings().getByText("Enter a point on the free surface.")).toBeTruthy();
    fireEvent.change(settings().getByLabelText("Fluid density"), { target: { value: "1000" } });
    const fields = settings().getAllByLabelText(/^[xyz]$/);
    // Gravity x, y, z, then the free-surface point x, y, z.
    for (const [k, value] of ["0", "0", "-9.81", "0", "0", "800"].entries()) {
      fireEvent.change(fields[k] as HTMLElement, { target: { value } });
    }
    expect(tree().getByRole("button", { name: "Hydrostatic pressure 1, complete" })).toBeTruthy();
    const mm = (value: number) => ({ value, unit: "mm" });
    const ms2 = (value: number) => ({ value, unit: "m/s²" });
    await waitFor(() =>
      expect(sent.at(-1)?.loads).toEqual([
        {
          id: "hydrostatic-1",
          type: "hydrostatic",
          name: "Hydrostatic pressure 1",
          faces: [3],
          fluidDensity: { value: 1000, unit: "kg/m³" },
          gravity: { x: ms2(0), y: ms2(0), z: ms2(-9.81) },
          freeSurface: { x: mm(0), y: mm(0), z: mm(800) },
        },
      ]),
    );
  });

  it("deletes an item and opens its group", async () => {
    const { sent, route } = saves();
    const spec: SimulationSpec = {
      ...emptySpec,
      supports: [{ id: "fixed-1", type: "fixed", name: "Base", faces: [3] }],
    };
    serve(routes([simulation(spec)], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Base, complete" }));
    fireEvent.click(settings().getByRole("button", { name: "Delete support" }));
    expect(tree().queryByRole("button", { name: /^Base/ })).toBeNull();
    expect(settings().getByRole("button", { name: "Add a fixed support" })).toBeTruthy();
    await waitFor(() => expect(sent.at(-1)?.supports).toEqual([]));
  });

  it("shows the API's reason when a save is refused", async () => {
    serve(
      routes([simulation()], {
        "PUT /api/simulations/s1/spec": { status: 400, json: { error: "The setup cannot be saved: something." } },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Materials, incomplete" }));
    fireEvent.click(settings().getByRole("button", { name: "Add an empty material" }));
    expect(await tree().findByText("Not saved: The setup cannot be saved: something.")).toBeTruthy();
  });
});

function mesh(overrides: Partial<MeshView> = {}): MeshView {
  return {
    id: "m1",
    geometryId: "g1",
    size: { value: 5, unit: "mm" },
    order: 2,
    local: [],
    status: "ready",
    problem: null,
    nodeCount: 7108,
    elementCount: 4000,
    quality: null,
    createdAt: "2026-10-15T12:00:00.000Z",
    ...overrides,
  };
}

const meshed: SimulationSpec = { ...emptySpec, mesh: { size: { value: 5, unit: "mm" } } };

describe("mesh", () => {
  it("asks for a size, then meshes with the saved size", async () => {
    const { sent, route } = saves();
    const fetchMock = serve(
      routes([simulation()], {
        "PUT /api/simulations/s1/spec": route,
        "POST /api/simulations/s1/mesh": { status: 201, json: { mesh: mesh({ status: "meshing", nodeCount: null, elementCount: null }) } },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Mesh, incomplete" }));
    expect(settings().getByText("Enter a global mesh size.")).toBeTruthy();
    const generate = settings().getByRole("button", { name: "Generate mesh" });
    expect(generate).toHaveProperty("disabled", true);

    // The geometry's own unit is offered first.
    expect(settings().getByLabelText("Global size unit")).toHaveProperty("value", "mm");
    fireEvent.change(settings().getByLabelText("Global size"), { target: { value: "5" } });
    expect(settings().getByText("Generate the mesh.")).toBeTruthy();
    await waitFor(() => expect(sent.at(-1)?.mesh).toEqual({ size: { value: 5, unit: "mm" } }));
    await waitFor(() => expect(generate).toHaveProperty("disabled", false));
    fireEvent.click(generate);
    expect(await settings().findByText("Meshing with a size of 5 mm…")).toBeTruthy();
    expect(tree().getByRole("button", { name: "Mesh, incomplete" }).getAttribute("title")).toBe("The mesh is being made.");
    expect(fetchMock.mock.calls.some(([path, init]) => path === "/api/simulations/s1/mesh" && init?.method === "POST")).toBe(true);
  });

  it("adds local sizes on faces, edges and bodies, and sets the element order (M2.8)", async () => {
    const { sent, route } = saves();
    serve(routes([simulation(meshed)], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    await screen.findByText(/Click a face to select it/);
    act(() => scene.events[0]?.onPick(7));
    fireEvent.click(tree().getByRole("button", { name: "Mesh, incomplete" }));
    fireEvent.change(settings().getByLabelText("Element order"), { target: { value: "1" } });
    await waitFor(() => expect(sent.at(-1)?.mesh.order).toBe(1));

    // On faces: the selected face, then a size.
    fireEvent.click(settings().getByRole("button", { name: "Add a local size on faces" }));
    expect(tree().getByRole("button", { name: "Local size 1, incomplete" }).getAttribute("title")).toBe("Enter the local size.");
    expect(settings().getByText("7")).toBeTruthy();
    fireEvent.change(settings().getByLabelText("Size"), { target: { value: "1" } });
    expect(tree().getByRole("button", { name: "Local size 1, complete" })).toBeTruthy();

    // A local size larger than the global size is refused by name.
    fireEvent.change(settings().getByLabelText("Size"), { target: { value: "8" } });
    expect(settings().getByText(/^The local size is larger than the global size/)).toBeTruthy();
    fireEvent.change(settings().getByLabelText("Size"), { target: { value: "1" } });

    // On edges: the viewer draws the geometry's edges and a click picks one.
    fireEvent.click(tree().getByRole("button", { name: /^Mesh,/ }));
    fireEvent.click(settings().getByRole("button", { name: "Add a local size on edges" }));
    expect(scene.geometryEdges.at(-1)).toEqual([5, 6]);
    expect(await screen.findByText(/Click an edge to select it/)).toBeTruthy();
    act(() => scene.events[0]?.onPick(6));
    expect(scene.edgeSelections.at(-1)).toEqual([6]);
    expect(screen.getByText(/1 edge selected/)).toBeTruthy();
    fireEvent.click(settings().getByRole("button", { name: "Use the selected edge" }));
    fireEvent.change(settings().getByLabelText("Size"), { target: { value: "0.5" } });

    // On bodies: a single-body geometry's body, shown by its faces.
    fireEvent.click(tree().getByRole("button", { name: /^Mesh,/ }));
    fireEvent.click(settings().getByRole("button", { name: "Add a local size on bodies" }));
    expect(scene.geometryEdges.at(-1)).toBeNull();
    expect(scene.selections.at(-1)).toEqual([3, 7]);
    expect(settings().getByRole("checkbox", { name: "Body 1" })).toHaveProperty("checked", true);
    fireEvent.change(settings().getByLabelText("Size"), { target: { value: "2" } });

    await waitFor(() =>
      expect(sent.at(-1)?.mesh.local).toEqual([
        { id: "local-1", name: "Local size 1", scope: "faces", tags: [7], size: { value: 1, unit: "mm" } },
        { id: "local-2", name: "Local size 2", scope: "edges", tags: [6], size: { value: 0.5, unit: "mm" } },
        { id: "local-3", name: "Local size 3", scope: "bodies", tags: [1], size: { value: 2, unit: "mm" } },
      ]),
    );
    expect(sent.at(-1)?.mesh).toMatchObject({ size: { value: 5, unit: "mm" }, order: 1 });

    // Deleting a local size opens the Mesh panel.
    fireEvent.click(settings().getByRole("button", { name: "Delete local size" }));
    expect(settings().getByRole("heading", { name: "Mesh" })).toBeTruthy();
    expect(tree().queryByRole("button", { name: /Local size 3/ })).toBeNull();
  });

  it("shows the quality summary of a ready mesh (M2.8)", async () => {
    const quality: MeshQuality = {
      shapeMin: 0.183,
      shapeMean: 0.742,
      shapeHistogram: [0, 2, 10, 50, 200, 600, 1100, 1300, 600, 138],
      jacobianMin: 0.912,
    };
    serve(
      routes([simulation(meshed)], {
        "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh({ quality }) } },
        "GET /api/meshes/m1/display": { status: 200, bytes: display },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Mesh, complete" }));
    const summary = await settings().findByRole("region", { name: "Mesh quality" });
    expect(within(summary).getByText("0.183")).toBeTruthy();
    expect(within(summary).getByText("0.742")).toBeTruthy();
    expect(within(summary).getByText("0.912")).toBeTruthy();
    expect(within(summary).getByTitle("0.6 to 0.7: 1,100 elements")).toBeTruthy();
  });

  it("draws a ready mesh with its element edges and counts while the Mesh item is open", async () => {
    const fetchMock = serve(
      routes([simulation(meshed)], {
        "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh() } },
        "GET /api/meshes/m1/display": { status: 200, bytes: display },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Mesh, complete" }));
    expect(settings().getByText("4,000")).toBeTruthy();
    expect(settings().getByText("7,108")).toBeTruthy();
    expect(await screen.findByText("Mesh: 4,000 elements, 7,108 nodes")).toBeTruthy();
    // The scene is given the mesh in an effect, which can run just after the text appears.
    await waitFor(() => expect(scene.edges.at(-1)).toBe("elements"));
    expect(fetchMock.mock.calls.some(([path]) => path === "/api/meshes/m1/display")).toBe(true);
    expect(settings().getByRole("button", { name: "Generate mesh again" })).toHaveProperty("disabled", true);

    // Back on the geometry the viewer draws the faces again.
    fireEvent.click(tree().getByRole("button", { name: "Geometry, complete" }));
    await waitFor(() => expect(scene.edges.at(-1)).toBe("outlines"));
    expect(screen.queryByText(/^Mesh: /)).toBeNull();
  });

  it("asks for a new mesh once the size changes, and shows why meshing failed", async () => {
    const stale = { ...emptySpec, mesh: { size: { value: 4, unit: "mm" } } };
    serve(routes([simulation(stale)], { "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh() } } }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Mesh, incomplete" }));
    expect(await settings().findByText("The mesh settings changed after the mesh was made. Generate the mesh again.")).toBeTruthy();
    cleanup();

    const problem = "Enter a mesh size of at least 0.656 mm.";
    serve(
      routes([simulation(meshed)], {
        "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh({ status: "failed", problem }) } },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Mesh, has a problem" }));
    expect(settings().getAllByText(problem)).toHaveLength(1);
    expect(settings().getByRole("button", { name: "Generate mesh again" })).toHaveProperty("disabled", false);
  });
});

describe("mesh reuse (M2.10)", () => {
  it("says when generating picked up a mesh made earlier with the same settings", async () => {
    serve(
      routes([simulation(meshed)], {
        "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh({ id: "m0", size: { value: 4, unit: "mm" } }) } },
        "POST /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh(), reused: true } },
        "GET /api/meshes/m0/display": { status: 200, bytes: display },
        "GET /api/meshes/m1/display": { status: 200, bytes: display },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Mesh, incomplete" }));
    expect(settings().queryByText(/^Reused the mesh/)).toBeNull();
    // The mesh loads after the tree item opens; wait for its button (it was a race).
    fireEvent.click(await settings().findByRole("button", { name: "Generate mesh again" }));
    expect(
      await settings().findByText("Reused the mesh made earlier with these settings. Nothing was meshed or charged again."),
    ).toBeTruthy();
    expect(tree().getByRole("button", { name: "Mesh, complete" })).toBeTruthy();
    expect(settings().getByRole("button", { name: "Generate mesh again" })).toHaveProperty("disabled", true);
  });

  it("does not say so for a new mesh", async () => {
    serve(
      routes([simulation(meshed)], {
        "POST /api/simulations/s1/mesh": {
          status: 201,
          json: { mesh: mesh({ status: "meshing", nodeCount: null, elementCount: null }), reused: false },
        },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Mesh, incomplete" }));
    fireEvent.click(settings().getByRole("button", { name: "Generate mesh" }));
    expect(await settings().findByText("Meshing with a size of 5 mm…")).toBeTruthy();
    expect(settings().queryByText(/meshed or charged again|not made or charged twice/)).toBeNull();
  });
});

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    id: "r1",
    simulationId: "s1",
    meshId: "m1",
    // Runs made since ADR-063 always name their solver.
    spec: { ...supported, solver: "pastix" },
    mesh: { size: { value: 5, unit: "mm" }, order: 2, nodeCount: 7108, elementCount: 4000 },
    software: { clearfea: "0.0.0+d9d394b", deckFormat: 1, calculix: "2.21", gmsh: "4.15.2", occt: "7.9.0" },
    files: [],
    machine: { size: "local", ratePerHour: 1_000_000 },
    estimate: null,
    cost: null,
    status: "solving",
    stage: "queued",
    problem: null,
    result: null,
    createdAt: "2026-10-15T12:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

/** A setup with nothing missing, so only the mesh decides whether it can run. */
const supported: SimulationSpec = {
  ...meshed,
  bodies: [{ tag: 1, material: "material-1" }],
  materials: [
    {
      id: "material-1",
      name: "Steel",
      model: "isotropic_elastic",
      youngsModulus: { value: 200, unit: "GPa" },
      poissonsRatio: 0.3,
    },
  ],
  supports: [{ id: "fixed-1", type: "fixed", name: "Base", faces: [3] }],
  loads: [{ id: "pressure-1", type: "pressure", name: "Top", faces: [7], magnitude: { value: 1, unit: "MPa" } }],
};

/** Routes of a setup whose run has succeeded, with its result files; ``beforeM32`` leaves out
 * what runs solved before M3.2 lack (reaction moments, load totals, the balance check). */
function finishedRun(beforeM32 = false, spec: SimulationSpec = supported): Record<string, Route> {
  const full: SolveResult = {
    nodes: 7108,
    displacement: { max: { value: 1.2e-4, node: 17, position: [0.1, 0.05, 0.02] } },
    vonMises: {
      min: { value: 1.5e3, node: 3, position: [0, 0.05, 0] },
      max: { value: 2.4e8, node: 40, position: [0, 0, 0] },
    },
    reactions: [{ supportId: "fixed-1", force: [0, 0, -400], moment: [2, -1.5, 0], point: [0, 0.05, 0.01] }],
    loads: [{ loadId: "pressure-1", force: [0, 0, 400.0001], moment: [20, -40, 0] }],
    balance: {
      appliedForce: [0, 0, 400.0001],
      appliedMoment: [20, -40, 0],
      reactionForce: [0, 0, -400],
      reactionMoment: [-20, 40.00001, 0],
      forceScale: 400.0001,
      momentScale: 48,
      forceRatio: 2.5e-7,
      momentRatio: 2.1e-7,
    },
    safetyFactor: { min: { value: 250e6 / 2.4e8, node: 40, position: [0, 0, 0] } },
    software: { calculix: "2.21" },
  };
  const { loads: _loads, balance: _balance, safetyFactor: _safetyFactor, ...older } = full;
  const result: SolveResult = beforeM32
    ? { ...older, reactions: (full.reactions ?? []).map(({ supportId, force }) => ({ supportId, force })) }
    : full;
  return {
    "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh() } },
    "GET /api/simulations/s1/runs": {
      status: 200,
      json: {
        runs: [
          run({
            spec,
            status: "succeeded",
            stage: null,
            result,
            cost: { billedSeconds: 13, amount: 3611, charged: true },
            finishedAt: "2026-10-15T12:01:00.000Z",
          }),
        ],
      },
    },
    "GET /api/runs/r1/log?after=0": { status: 200, json: { text: " Job finished\n", next: 1 } },
    "GET /api/runs/r1/log?after=1": { status: 200, json: { text: "", next: 1 } },
    "GET /api/runs/r1/surface": { status: 200, bytes: display },
    "GET /api/runs/r1/fields": { status: 200, bytes: twoFacesFields({ safety: !beforeM32 }) },
  };
}

describe("run", () => {
  it("lists what stops the setup from running, and each line opens its item", async () => {
    const incomplete: SimulationSpec = {
      ...supported,
      materials: [],
      bodies: [{ tag: 1, material: null }],
      loads: [{ id: "pressure-1", type: "pressure", name: "Top", faces: [], magnitude: null }],
    };
    serve(routes([simulation(incomplete)], { "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh() } } }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, incomplete" }));
    const list = within(await settings().findByLabelText("Before running"));
    expect(settings().getByRole("button", { name: "Run" })).toHaveProperty("disabled", true);
    expect(list.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "There is no material. Add a material under Materials.",
      'Load "Top" has no faces. Select the faces it acts on and add them to it.',
      'Load "Top" has no pressure value. Enter it.',
    ]);
    fireEvent.click(list.getByRole("button", { name: 'Load "Top" has no pressure value. Enter it.' }));
    expect(settings().getByRole("region", { name: "Pressure" })).toBeTruthy();
  });

  it("waits for a current mesh, then solves and shows the solver log", async () => {
    serve(routes([simulation(supported)]));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, incomplete" }));
    expect(settings().getByRole("button", { name: "Run" })).toHaveProperty("disabled", true);
    expect(settings().getByText("There is no mesh. Generate it under Mesh.")).toBeTruthy();
    cleanup();

    const fetchMock = serve(
      routes([simulation(supported)], {
        "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh() } },
        "POST /api/simulations/s1/runs": { status: 201, json: { run: run() } },
        "GET /api/runs/r1/log?after=0": { status: 200, json: { text: "CalculiX Version 2.21\n", next: 1 } },
        "GET /api/runs/r1/log?after=1": { status: 200, json: { text: "", next: 1 } },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, incomplete" }));
    const button = settings().getByRole("button", { name: "Run" });
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    // The estimate for the mesh, with the recommended size chosen.
    const estimate = within(await settings().findByLabelText("Estimate"));
    expect(estimate.getByText("about 95 MiB at its peak")).toBeTruthy();
    expect(estimate.getByText("about 3 s")).toBeTruthy();
    const size = estimate.getByRole("combobox", { name: "Machine size" }) as HTMLSelectElement;
    expect(size.value).toBe("small");
    expect([...size.options].map((o) => o.text)).toEqual([
      "small (2 cores, 8 GiB), recommended",
      "medium (4 cores, 16 GiB)",
    ]);
    expect(estimate.getByText("about 0.000417 credits on small")).toBeTruthy();
    fireEvent.click(button);
    expect(await settings().findByText("Waiting for the solver…")).toBeTruthy();
    expect(await settings().findByText("CalculiX Version 2.21")).toBeTruthy();
    expect(within(settings().getByLabelText("Run record")).getByText("Counted when the run has finished.")).toBeTruthy();
    expect(settings().getByRole("button", { name: "Run again" })).toHaveProperty("disabled", true);
    expect(tree().getByRole("button", { name: "Run, incomplete" }).getAttribute("title")).toBe(
      "The simulation is being solved.",
    );
    const post = fetchMock.mock.calls.find(([path, init]) => path === "/api/simulations/s1/runs" && init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ machineSize: "small" });
  });

  it("runs on the machine size the user picks, and says when it has too little memory", async () => {
    const tight: RunEstimate = {
      ...ESTIMATE,
      memoryBytes: 10 * GiB,
      sizes: ESTIMATE.sizes.map((s) => ({ ...s, fits: s.size === "medium" })),
      recommended: "medium",
    };
    const fetchMock = serve(
      routes([simulation(supported)], {
        "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh() } },
        "GET /api/simulations/s1/estimate?solver=pastix&analysis=linear_static": { status: 200, json: { estimate: tight } },
        "POST /api/simulations/s1/runs": { status: 201, json: { run: run() } },
        "GET /api/runs/r1/log?after=0": { status: 200, json: { text: "", next: 0 } },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, incomplete" }));
    const estimate = within(await settings().findByLabelText("Estimate"));
    const size = estimate.getByRole("combobox", { name: "Machine size" }) as HTMLSelectElement;
    expect(size.value).toBe("medium");
    expect(size.options[0]?.text).toBe("small (2 cores, 8 GiB), too little memory");
    fireEvent.change(size, { target: { value: "small" } });
    expect(estimate.getByText("about 0.000417 credits on small")).toBeTruthy();
    expect(
      estimate.getByText(
        "The estimate needs more memory than this size has, so the run may stop for lack of memory, and the time it used is then charged. The recommended size is medium.",
      ),
    ).toBeTruthy();
    const button = settings().getByRole("button", { name: "Run" });
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    fireEvent.click(button);
    expect(await settings().findByText("Waiting for the solver…")).toBeTruthy();
    const post = fetchMock.mock.calls.find(([path, init]) => path === "/api/simulations/s1/runs" && init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ machineSize: "small" });
  });

  it("chooses the solver, PaStiX first, saves it and estimates for it, warning about the iterative ones", async () => {
    const { sent, route } = saves();
    const fetchMock = serve(
      routes([simulation(supported)], {
        "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh() } },
        "PUT /api/simulations/s1/spec": route,
        "GET /api/simulations/s1/estimate?solver=iterative_cholesky&analysis=linear_static": {
          status: 200,
          json: { estimate: { ...ESTIMATE, solver: "iterative_cholesky" } },
        },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, incomplete" }));
    const solver = (await settings().findByRole("combobox", { name: "Equation solver" })) as HTMLSelectElement;
    expect(solver.value).toBe("pastix");
    expect([...solver.options].map((o) => o.value)).toEqual(["pastix", "spooles", "iterative_cholesky", "iterative_scaling"]);
    expect(solver.options[0]?.text).toBe(
      `PaStiX (direct, fastest), up to ${maxElements("pastix", 2).toLocaleString("en-US")} elements`,
    );
    expect(settings().queryByText(/Iterative solvers stop at a fixed relative residual/)).toBeNull();
    fireEvent.change(solver, { target: { value: "iterative_cholesky" } });
    expect(settings().getByText(ITERATIVE_ACCURACY_NOTE)).toBeTruthy();
    await waitFor(() => expect(sent.at(-1)?.solver).toBe("iterative_cholesky"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([path]) => path === "/api/simulations/s1/estimate?solver=iterative_cholesky&analysis=linear_static")).toBe(
        true,
      ),
    );
  });

  it("refuses a mesh above the solver's element limit before running", async () => {
    const elements = maxElements("pastix", 2) + 1;
    serve(
      routes([simulation(supported)], {
        "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh({ elementCount: elements }) } },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, incomplete" }));
    const problem = elementLimitProblem("pastix", 2, elements) ?? "";
    expect(await settings().findByText(problem)).toBeTruthy();
    expect(settings().getByRole("button", { name: "Run" })).toHaveProperty("disabled", true);
  });

  it("names the solver in the run record: SPOOLES for runs made before the choice", async () => {
    serve(
      routes([simulation(supported)], {
        "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh() } },
        "GET /api/simulations/s1/runs": {
          status: 200,
          json: { runs: [run({ spec: supported, status: "failed", stage: null, problem: "x", finishedAt: "2026-10-15T12:01:00.000Z" })] },
        },
        "GET /api/runs/r1/log?after=0": { status: 200, json: { text: "", next: 0 } },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, has a problem" }));
    const record = within(settings().getByLabelText("Run record"));
    expect(record.getByText("SPOOLES")).toBeTruthy();
    // A new run would use PaStiX, so the setup counts as changed.
    expect(record.getByText(/The setup has changed/)).toBeTruthy();
  });

  it("shows a finished run's figures in display units, with numbers only", async () => {
    serve(routes([simulation(supported)], finishedRun()));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    // The viewer shows the results: von Mises on the exaggerated deformed shape by default.
    const legend = await screen.findByLabelText("Legend");
    expect(legend.textContent).toContain("Von Mises stress (MPa)");
    expect(legend.textContent).toContain("Deformed shape, scale ×5");
    // The quantity list is grouped: displacement, then stresses, then strains (M3.1), then the
    // safety factor (M3.5).
    const quantity = settings().getByLabelText("Quantity");
    expect([...quantity.querySelectorAll("optgroup")].map((g) => g.label)).toEqual([
      "Displacement",
      "Stress",
      "Strain",
      "Safety factor",
    ]);
    expect([...quantity.querySelectorAll("optgroup[label=Stress] option")].map((o) => o.textContent)).toEqual([
      "Von Mises stress",
      "Maximum principal stress σ1",
      "Middle principal stress σ2",
      "Minimum principal stress σ3",
      "Normal stress σxx",
      "Normal stress σyy",
      "Normal stress σzz",
      "Shear stress τxy",
      "Shear stress τyz",
      "Shear stress τzx",
    ]);
    expect(quantity.querySelectorAll("optgroup[label=Strain] option")).toHaveLength(6);
    fireEvent.change(quantity, { target: { value: "displacement" } });
    fireEvent.change(settings().getByLabelText("Shape"), { target: { value: "undeformed" } });
    expect(legend.textContent).toContain("Displacement magnitude (mm)");
    expect(legend.textContent).toContain("Undeformed shape");
    const figures = within(settings().getByLabelText("Run results"));
    expect(figures.getByText("0.12 mm")).toBeTruthy();
    expect(figures.getByText("at (100, 50, 20) mm")).toBeTruthy();
    expect(figures.getByText("240 MPa")).toBeTruthy();
    expect(figures.getByText("0.0015 MPa")).toBeTruthy();
    // The smallest safety factor against yield, a number without a unit (M3.5), and its contour.
    expect(figures.getByText("1.04")).toBeTruthy();
    fireEvent.change(quantity, { target: { value: "safetyFactor" } });
    await waitFor(() => expect(legend.textContent).toContain("Safety factor against yield"));
    expect(legend.textContent).not.toContain("Safety factor against yield (");
    expect(figures.getByText("Reaction, Base")).toBeTruthy();
    expect(figures.getByText("(0, 0, -400) N")).toBeTruthy();
    // Moments in N·mm about the support's faces' centre; the load's total; the balance (M3.2).
    expect(figures.getByText(/moment \(2000, -1500, 0\) N·mm about the faces' centre at \(0, 50, 10\) mm/)).toBeTruthy();
    expect(figures.getByText("Applied, Top")).toBeTruthy();
    expect(figures.getByText("(0, 0, 400) N")).toBeTruthy();
    expect(figures.getByText("Out of balance").nextElementSibling?.textContent).toBe(
      "force 0.000025 % of 400 N, moment 0.000021 % of 48000 N·mm",
    );
    expect(within(settings().getByLabelText("Run record")).getByText("0.003611 credits for 13 s")).toBeTruthy();
    expect(settings().queryByText(/pass|fail|complian/i)).toBeNull();
    expect(settings().getByRole("button", { name: "Run again" })).toHaveProperty("disabled", false);
  });

  it("asks to run again for reaction moments and the balance on a run solved before them", async () => {
    serve(routes([simulation(supported)], finishedRun(true)));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    const figures = within(await settings().findByLabelText("Run results"));
    expect(figures.getByText("(0, 0, -400) N")).toBeTruthy();
    expect(figures.queryByText(/about the faces/)).toBeNull();
    expect(figures.getByText("Run again to see reaction moments and the balance of loads and reactions.")).toBeTruthy();
    // Nor has it a safety factor (M3.5).
    expect(figures.getByText("None: it needs a yield strength for every material. Enter them under Materials and run again.")).toBeTruthy();
  });

  it("notes that stresses near bonded faces are less accurate on a run that tied bonds (M4.5)", async () => {
    const tied: SimulationSpec = { ...supported, bonds: [{ faces: [3, 7], status: "accepted" }] };
    serve(routes([simulation(supported)], finishedRun(false, tied)));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    const note = await settings().findByRole("note", { name: "Stresses near bonded faces" });
    expect(note.textContent).toMatch(/^Stresses near bonded faces\. The bodies of this model are meshed separately/);
    expect(note.textContent).toContain("13% below to 12% above the exact value with 10-node elements");
    expect(settings().queryByText(/pass|fail|complian/i)).toBeNull();
  });

  it("leaves the note out when every bond was removed or there were none", async () => {
    const removed: SimulationSpec = { ...supported, bonds: [{ faces: [3, 7], status: "removed" }] };
    serve(routes([simulation(supported)], finishedRun(false, removed)));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    await settings().findByLabelText("Run results");
    expect(settings().queryByRole("note", { name: "Stresses near bonded faces" })).toBeNull();
  });

  it("shows the run record with its versions and links to view and download the deck and log", async () => {
    // The run was solved before the support was renamed: its record says the setup differs.
    const before: SimulationSpec = { ...supported, supports: supported.supports.map((s) => ({ ...s, name: "Old base" })) };
    serve(
      routes([simulation(supported)], {
        "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh() } },
        "GET /api/simulations/s1/runs": {
          status: 200,
          json: {
            runs: [
              run({
                spec: before,
                status: "failed",
                stage: null,
                problem: "CalculiX stopped on the deck.",
                files: ["deck.inp", "solver.log"],
                cost: { billedSeconds: 3, amount: 0, charged: false },
                finishedAt: "2026-10-15T12:01:00.000Z",
              }),
            ],
          },
        },
        "GET /api/runs/r1/log?after=0": { status: 200, json: { text: "", next: 0 } },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, has a problem" }));
    const record = within(settings().getByLabelText("Run record"));
    expect(record.getByText(/The setup has changed since this run/)).toBeTruthy();
    expect(record.getByText("2026-10-15 12:00:00 UTC")).toBeTruthy();
    expect(record.getByText("2026-10-15 12:01:00 UTC")).toBeTruthy();
    expect(record.getByText("5 mm, quadratic tetrahedra (10 nodes); 4,000 elements, 7,108 nodes")).toBeTruthy();
    expect(record.getByText("0.0.0+d9d394b")).toBeTruthy();
    expect(record.getByText("2.21")).toBeTruthy();
    expect(record.getByText("with OpenCASCADE 7.9.0")).toBeTruthy();
    expect(record.getByText("local, 1 credit per hour")).toBeTruthy();
    expect(record.getByText("Not charged: the run stopped because of a fault in ClearFEA (3 s).")).toBeTruthy();
    expect(record.getByRole("link", { name: "View deck.inp" }).getAttribute("href")).toBe("/api/runs/r1/files/deck.inp");
    expect(record.getByRole("link", { name: "View solver.log" }).getAttribute("href")).toBe(
      "/api/runs/r1/files/solver.log",
    );
    expect(record.getAllByRole("link", { name: "Download" }).map((link) => link.getAttribute("href"))).toEqual([
      "/api/runs/r1/files/deck.inp?download=1",
      "/api/runs/r1/files/solver.log?download=1",
    ]);
  });

  it("says when a run has no deck or log, and that versions are unknown for older runs", async () => {
    serve(
      routes([simulation(supported)], {
        "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh() } },
        "GET /api/simulations/s1/runs": {
          status: 200,
          json: {
            runs: [
              run({
                status: "failed",
                stage: null,
                problem: "Add a support.",
                software: { clearfea: null, deckFormat: null, calculix: null, gmsh: null, occt: null },
                machine: null,
                finishedAt: "2026-10-15T12:01:00.000Z",
              }),
            ],
          },
        },
        "GET /api/runs/r1/log?after=0": { status: 200, json: { text: "", next: 0 } },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, has a problem" }));
    const record = within(settings().getByLabelText("Run record"));
    expect(record.queryByText(/The setup has changed/)).toBeNull();
    expect(record.getAllByText("None: the run stopped before the solver started.")).toHaveLength(2);
    expect(record.getAllByText("not recorded")).toHaveLength(4);
    expect(record.getByText("Not metered: the run was made before metering.")).toBeTruthy();
    expect(record.queryByText("Machine")).toBeNull();
    expect(record.queryByRole("link")).toBeNull();
  });

  it("shows why a run failed", async () => {
    const problem = "Body 1 has no material. Assign a material to it.";
    serve(
      routes([simulation(supported)], {
        "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh() } },
        "GET /api/simulations/s1/runs": {
          status: 200,
          json: { runs: [run({ status: "failed", stage: null, problem, finishedAt: "2026-10-15T12:01:00.000Z" })] },
        },
        "GET /api/runs/r1/log?after=0": { status: 200, json: { text: "", next: 0 } },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, has a problem" }));
    expect(settings().getAllByText(problem)).toHaveLength(1);
  });
});

describe("unit system", () => {
  const unitSystem = () => tree().getByLabelText("Unit system") as HTMLSelectElement;

  function patches() {
    const sent: unknown[] = [];
    const route = (init?: RequestInit): Reply => {
      const body = JSON.parse(String(init?.body)) as { unitSystem: string };
      sent.push(body);
      return { status: 200, json: { project: { id: "p1", name: "My project", unitSystem: body.unitSystem } } };
    };
    return { sent, route };
  }

  it("offers the system's unit in an empty field and follows a change; a typed value keeps its unit", async () => {
    const { sent, route } = patches();
    const unloaded: SimulationSpec = {
      ...supported,
      loads: [{ id: "pressure-1", type: "pressure", name: "Top", faces: [7], magnitude: null }],
    };
    serve(routes([simulation(unloaded)], { "PATCH /api/project": route }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Top, incomplete" }));
    await waitFor(() => expect(unitSystem().value).toBe("metric-mm"));
    expect(settings().getByLabelText("Magnitude unit")).toHaveProperty("value", "MPa");

    fireEvent.change(unitSystem(), { target: { value: "us-in" } });
    expect(settings().getByLabelText("Magnitude unit")).toHaveProperty("value", "psi");
    await waitFor(() => expect(sent).toEqual([{ unitSystem: "us-in" }]));

    // The material's modulus was entered in GPa and stays so; nothing is converted.
    fireEvent.click(tree().getByRole("button", { name: "Steel, complete" }));
    expect(settings().getByLabelText("Young's modulus unit")).toHaveProperty("value", "GPa");
    expect(settings().getByLabelText("Young's modulus")).toHaveProperty("value", "200");
  });

  it("shows result figures and the legend in the chosen system without running again", async () => {
    const { route } = patches();
    const fetchMock = serve(routes([simulation(supported)], { ...finishedRun(), "PATCH /api/project": route }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    const legend = await screen.findByLabelText("Legend");
    expect(legend.textContent).toContain("Von Mises stress (MPa)");

    fireEvent.change(unitSystem(), { target: { value: "us-in" } });
    expect(legend.textContent).toContain("Von Mises stress (psi)");
    const figures = within(settings().getByLabelText("Run results"));
    // 1.2e-4 m = 0.004724 in; 2.4e8 Pa = 34810 psi; 400 N = 89.92 lbf (to four figures).
    expect(figures.getByText("0.004724 in")).toBeTruthy();
    expect(figures.getByText("at (3.937, 1.969, 0.7874) in")).toBeTruthy();
    expect(figures.getByText("34810 psi")).toBeTruthy();
    expect(figures.getByText("(0, 0, -89.92) lbf")).toBeTruthy();

    fireEvent.change(unitSystem(), { target: { value: "si" } });
    expect(legend.textContent).toContain("Von Mises stress (Pa)");
    expect(figures.getByText("240000000 Pa")).toBeTruthy();
    expect(figures.getByText("0.00012 m")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("shows results in units picked in the result view, kept for the user and put back on request", async () => {
    window.localStorage.clear();
    const fetchMock = serve(routes([simulation(supported)], finishedRun()));
    const { unmount } = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    const legend = await screen.findByLabelText("Legend");
    const stress = settings().getByLabelText("Stress") as HTMLSelectElement;
    expect(stress.value).toBe("");
    expect(within(stress).getByRole("option", { name: "As the unit system (MPa)" })).toBeTruthy();

    // 2.4e8 Pa = 34.81 ksi; 1.2e-4 m = 0.012 cm; 400 N = 0.4 kN.
    fireEvent.change(stress, { target: { value: "ksi" } });
    fireEvent.change(settings().getByLabelText("Length"), { target: { value: "cm" } });
    fireEvent.change(settings().getByLabelText("Force"), { target: { value: "kN" } });
    expect(legend.textContent).toContain("Von Mises stress (ksi)");
    const figures = within(settings().getByLabelText("Run results"));
    expect(figures.getByText("34.81 ksi")).toBeTruthy();
    expect(figures.getByText("0.012 cm")).toBeTruthy();
    expect(figures.getByText("(0, 0, -0.4) kN")).toBeTruthy();
    // The unit system still sets the units offered first for input; it stays as it was.
    expect(unitSystem().value).toBe("metric-mm");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST" || init?.method === "PATCH")).toBe(false);

    // Kept in this browser for the user: still there after the page is opened again.
    unmount();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    expect((await screen.findByLabelText("Legend")).textContent).toContain("Von Mises stress (ksi)");
    expect((settings().getByLabelText("Stress") as HTMLSelectElement).value).toBe("ksi");

    fireEvent.click(settings().getByRole("button", { name: "Show all in the unit system" }));
    expect(screen.getByLabelText("Legend").textContent).toContain("Von Mises stress (MPa)");
    expect(within(settings().getByLabelText("Run results")).getByText("0.12 mm")).toBeTruthy();
    expect(settings().queryByRole("button", { name: "Show all in the unit system" })).toBeNull();
    window.localStorage.clear();
  });

  it("offers the export of a succeeded run, the node files only when the run kept its node values", async () => {
    serve(routes([simulation(supported)], finishedRun()));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    const exports = within(await settings().findByRole("region", { name: "Export" }));
    // This run has no nodes.bin (solved before M3.4): only the reactions can be exported.
    expect(exports.getByRole("button", { name: "Results at every node (CSV)" })).toHaveProperty("disabled", true);
    expect(exports.getByRole("button", { name: "Mesh and results (VTK)" })).toHaveProperty("disabled", true);
    expect(exports.getByRole("button", { name: "Reactions and loads (CSV)" })).toHaveProperty("disabled", false);
    expect(exports.getByText(/Run again to export the results at every node/)).toBeTruthy();
  });

  it("shows strain in microstrain when picked", async () => {
    window.localStorage.clear();
    serve(routes([simulation(supported)], finishedRun()));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    fireEvent.change(settings().getByLabelText("Quantity"), { target: { value: "strainXX" } });
    const legend = await screen.findByLabelText("Legend");
    await waitFor(() => expect(legend.textContent).toContain("(mm/mm)"));
    fireEvent.change(settings().getByLabelText("Strain"), { target: { value: "µε" } });
    expect(legend.textContent).toContain("(µε)");
    window.localStorage.clear();
  });

  it("ignores a stored unit that is not one of the kind's", async () => {
    window.localStorage.setItem("clearfea.resultUnits.a", JSON.stringify({ pressure: "lbf", length: "in" }));
    serve(routes([simulation(supported)], finishedRun()));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    expect((await screen.findByLabelText("Legend")).textContent).toContain("Von Mises stress (MPa)");
    expect((settings().getByLabelText("Length") as HTMLSelectElement).value).toBe("in");
    window.localStorage.clear();
  });

  it("puts the system back and says why when the API refuses the change", async () => {
    serve(
      routes([simulation()], {
        "PATCH /api/project": { status: 400, json: { error: "'us-in' is not a unit system." } },
      }),
    );
    render(<App />);
    await waitFor(() => expect(unitSystem().value).toBe("metric-mm"));
    fireEvent.change(unitSystem(), { target: { value: "us-in" } });
    expect(await tree().findByText("The unit system was not changed: 'us-in' is not a unit system.")).toBeTruthy();
    expect(unitSystem().value).toBe("metric-mm");
  });
});

describe("steady-state thermal analysis (M5.1)", () => {
  /** A thermal setup with nothing missing but its fixed temperature. */
  const thermalSpec: SimulationSpec = {
    ...meshed,
    analysis: "steady_thermal",
    bodies: [{ tag: 1, material: "steel" }],
    materials: [
      {
        id: "steel",
        name: "Steel",
        model: "isotropic_elastic",
        youngsModulus: null,
        poissonsRatio: null,
        thermalConductivity: { value: 45, unit: "W/(m·K)" },
      },
    ],
  };

  const heated: SimulationSpec = {
    ...thermalSpec,
    loads: [
      { id: "fixed_temperature-1", type: "fixed_temperature", name: "Hot", faces: [3], temperature: { value: 100, unit: "°C" } },
      { id: "fixed_temperature-2", type: "fixed_temperature", name: "Cold", faces: [7], temperature: { value: 20, unit: "°C" } },
    ],
  };

  /** Routes of a succeeded thermal run: temperatures from 20 °C to 100 °C and, unless solved
   * before M5.3, a heat flux of 4 kW/m² along -x, 25 W in through the hot face and out
   * through the cold one. */
  function thermalRun(beforeHeatFlux = false): Record<string, Route> {
    const result: SolveResult = {
      nodes: 7108,
      temperature: {
        min: { value: 293.15, node: 3, position: [0.1, 0.05, 0] },
        max: { value: 373.15, node: 40, position: [0, 0, 0] },
      },
      ...(beforeHeatFlux
        ? {}
        : {
            heatFlux: { max: { value: 4000, node: 12, position: [0.05, 0, 0] } },
            heatFlows: [
              { loadId: "fixed_temperature-1", heat: 25 },
              { loadId: "fixed_temperature-2", heat: -24.9999 },
            ],
            heatBalance: { heatIn: 25, heatOut: 24.9999, scale: 25, ratio: 4e-6 },
          }),
      software: { calculix: "2.21" },
    };
    const fields = encodeFields(7, [
      { name: "temperature", kind: "temperature", components: 1, values: Array.from({ length: 7 }, (_, v) => 293.15 + (80 * v) / 6) },
      ...(beforeHeatFlux
        ? []
        : [{ name: "heatFlux", kind: "heatFlux", components: 3, values: Array.from({ length: 21 }, (_, k) => (k % 3 === 0 ? -4000 : 0)) }]),
    ]);
    return {
      "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh() } },
      "GET /api/simulations/s1/runs": {
        status: 200,
        json: {
          runs: [
            run({
              spec: heated,
              status: "succeeded",
              stage: null,
              result,
              files: ["deck.inp", "solver.log", "nodes.bin"],
              cost: { billedSeconds: 3, amount: 833, charged: true },
              finishedAt: "2026-10-15T12:01:00.000Z",
            }),
          ],
        },
      },
      "GET /api/runs/r1/log?after=0": { status: 200, json: { text: " Job finished\n", next: 1 } },
      "GET /api/runs/r1/log?after=1": { status: 200, json: { text: "", next: 1 } },
      "GET /api/runs/r1/surface": { status: 200, bytes: display },
      "GET /api/runs/r1/fields": { status: 200, bytes: fields },
    };
  }

  it("switches the analysis type and marks what no longer belongs until it is deleted", async () => {
    const { sent, route } = saves();
    serve(routes([simulation(supported)], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    // The Analysis row sits between Geometry and Bodies.
    const analysis = await screen.findByRole("button", { name: "Analysis, complete" });
    const rows = tree().getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(rows.slice(0, 3)).toEqual(["Geometry, complete", "Analysis, complete", "Bodies, complete"]);
    fireEvent.click(analysis);
    const linear = settings().getByRole("radio", { name: "Linear static" });
    const thermal = settings().getByRole("radio", { name: "Steady-state thermal" });
    expect(linear).toHaveProperty("checked", true);
    expect(
      settings().getByText(
        "Steady-state heat conduction: temperatures from fixed temperatures, heat fluxes, convection and radiation on faces and heat generated in bodies; faces with none of them are insulated.",
      ),
    ).toBeTruthy();

    fireEvent.click(thermal);
    await waitFor(() => expect(sent.at(-1)?.analysis).toBe("steady_thermal"));
    // Only the analysis changed; the support and the pressure stay, marked as having no effect.
    expect({ ...sent.at(-1), analysis: "linear_static" }).toEqual(supported);
    expect(tree().getByRole("button", { name: "Base, has a problem" }).getAttribute("title")).toBe(
      'Fixed support "Base" has no effect in a steady-state thermal analysis. Delete it, or set the analysis type to linear static.',
    );
    expect(tree().getByRole("button", { name: "Top, has a problem" })).toBeTruthy();
    expect(tree().getByRole("button", { name: "Steel, incomplete" }).getAttribute("title")).toBe(
      "Enter the thermal conductivity; a steady-state thermal analysis needs it.",
    );

    // Once its supports are deleted, a thermal setup has no Supports group.
    fireEvent.click(tree().getByRole("button", { name: "Base, has a problem" }));
    fireEvent.click(settings().getByRole("button", { name: "Delete support" }));
    expect(tree().queryByRole("button", { name: /^Supports,/ })).toBeNull();
    fireEvent.click(tree().getByRole("button", { name: "Analysis, complete" }));
    fireEvent.click(settings().getByRole("radio", { name: "Linear static" }));
    expect(tree().getByRole("button", { name: "Supports, incomplete" })).toBeTruthy();
    expect(tree().getByRole("button", { name: "Top, complete" })).toBeTruthy();
  });

  it("offers only thermal loads, a fixed temperature on the selected faces, and asks the material for its conductivity", async () => {
    const { sent, route } = saves();
    const unset: SimulationSpec = {
      ...thermalSpec,
      materials: [{ ...thermalSpec.materials[0], thermalConductivity: null } as SimulationSpec["materials"][number]],
    };
    serve(routes([simulation(unset)], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    await screen.findByText(/Click a face to select it/);
    expect(tree().queryByRole("button", { name: /^Supports,/ })).toBeNull();
    expect(tree().getByRole("button", { name: "Loads, incomplete" }).getAttribute("title")).toBe(
      "Add a fixed temperature, convection or radiation.",
    );

    act(() => scene.events[0]?.onPick(3));
    fireEvent.click(tree().getByRole("button", { name: "Loads, incomplete" }));
    expect(
      settings().getByText(
        "Select faces in the viewer first to give a new fixed temperature, heat flux, convection or radiation those faces. Heat generation acts on the bodies you tick. Every body needs a fixed temperature, convection or radiation.",
      ),
    ).toBeTruthy();
    expect(within(settings().getByRole("region", { name: "Loads" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Add a fixed temperature",
      "Add a heat flux",
      "Add convection",
      "Add radiation",
      "Add heat generation",
    ]);
    fireEvent.click(settings().getByRole("button", { name: "Add a fixed temperature" }));
    expect(tree().getByRole("button", { name: "Fixed temperature 1, incomplete" })).toBeTruthy();
    expect(settings().getByRole("heading", { name: "Fixed temperature" })).toBeTruthy();
    expect(
      settings().getByText(
        "Holds every node of the faces at this temperature. Faces with no thermal load are insulated: no heat crosses them.",
      ),
    ).toBeTruthy();
    expect(settings().getByText("Enter the temperature.")).toBeTruthy();
    expect(settings().getByLabelText("Temperature unit")).toHaveProperty("value", "°C");
    fireEvent.change(settings().getByLabelText("Temperature"), { target: { value: "-40" } });
    expect(tree().getByRole("button", { name: "Fixed temperature 1, complete" })).toBeTruthy();
    await waitFor(() =>
      expect(sent.at(-1)?.loads).toEqual([
        {
          id: "fixed_temperature-1",
          type: "fixed_temperature",
          name: "Fixed temperature 1",
          faces: [3],
          temperature: { value: -40, unit: "°C" },
        },
      ]),
    );

    // The material needs its thermal conductivity, not Young's modulus or Poisson's ratio.
    fireEvent.click(tree().getByRole("button", { name: "Steel, incomplete" }));
    expect(settings().getByText("Enter the thermal conductivity; a steady-state thermal analysis needs it.")).toBeTruthy();
    expect(settings().queryByText("Enter Young's modulus.")).toBeNull();
    expect(
      settings().getByText("For example 45 W/(m·K) for carbon steel. Needed for a steady-state thermal and a thermal stress analysis."),
    ).toBeTruthy();
    fireEvent.change(settings().getByLabelText("Thermal conductivity"), { target: { value: "45" } });
    expect(tree().getByRole("button", { name: "Steel, complete" })).toBeTruthy();
    await waitFor(() =>
      expect(sent.at(-1)?.materials[0]?.thermalConductivity).toEqual({ value: 45, unit: "W/(m·°C)" }),
    );
  });

  it("gives the conductivity as a table against temperature in place of its value (M5.5)", async () => {
    const { sent, route } = saves();
    const unset: SimulationSpec = {
      ...thermalSpec,
      materials: [{ ...thermalSpec.materials[0], thermalConductivity: null } as SimulationSpec["materials"][number]],
    };
    serve(routes([simulation(unset)], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    await screen.findByText(/Click a face to select it/);
    fireEvent.click(tree().getByRole("button", { name: "Steel, incomplete" }));
    fireEvent.click(settings().getByRole("button", { name: "Vary thermal conductivity with temperature" }));
    const table = within(settings().getByRole("group", { name: "Thermal conductivity against temperature" }));
    expect(table.getByLabelText("Thermal conductivity table temperature unit")).toHaveProperty("value", "°C");
    expect(table.getByLabelText("Thermal conductivity table unit")).toHaveProperty("value", "W/(m·°C)");
    // Two empty rows to start with; the material lists what the table still needs.
    expect(settings().getAllByText("The thermal conductivity table: row 1 is not complete. Fill it in, or delete the row.")).toHaveLength(1);
    fireEvent.change(table.getByLabelText("Row 1 temperature"), { target: { value: "20" } });
    fireEvent.change(table.getByLabelText("Row 1 Thermal conductivity"), { target: { value: "50" } });
    fireEvent.change(table.getByLabelText("Row 2 temperature"), { target: { value: "400" } });
    fireEvent.change(table.getByLabelText("Row 2 Thermal conductivity"), { target: { value: "38" } });
    expect(tree().getByRole("button", { name: "Steel, complete" })).toBeTruthy();
    fireEvent.click(table.getByRole("button", { name: "Add a row" }));
    expect(tree().getByRole("button", { name: "Steel, incomplete" })).toBeTruthy();
    fireEvent.click(table.getByRole("button", { name: "Remove row 3" }));
    expect(tree().getByRole("button", { name: "Steel, complete" })).toBeTruthy();
    await waitFor(() =>
      expect(sent.at(-1)?.materials[0]?.thermalConductivityTable).toEqual({
        temperatureUnit: "°C",
        unit: "W/(m·°C)",
        rows: [
          { temperature: 20, value: 50 },
          { temperature: 400, value: 38 },
        ],
      }),
    );
    fireEvent.click(table.getByRole("button", { name: "Remove the table" }));
    expect(tree().getByRole("button", { name: "Steel, incomplete" })).toBeTruthy();
    await waitFor(() => expect(sent.at(-1)?.materials[0]?.thermalConductivityTable).toBeNull());
  });

  it("sets up convection and radiation on the selected faces and heat generation in the bodies (M5.2)", async () => {
    const { sent, route } = saves();
    serve(routes([simulation(thermalSpec)], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    await screen.findByText(/Click a face to select it/);

    act(() => scene.events[0]?.onPick(7));
    fireEvent.click(tree().getByRole("button", { name: "Loads, incomplete" }));
    fireEvent.click(settings().getByRole("button", { name: "Add convection" }));
    expect(settings().getByRole("heading", { name: "Convection" })).toBeTruthy();
    expect(settings().getByText("Enter the convection coefficient.")).toBeTruthy();
    fireEvent.change(settings().getByLabelText("Convection coefficient"), { target: { value: "25" } });
    fireEvent.change(settings().getByLabelText("Ambient temperature"), { target: { value: "20" } });
    expect(tree().getByRole("button", { name: "Convection 1, complete" })).toBeTruthy();
    // Convection sets the temperature, so the setup needs no fixed temperature.
    expect(tree().getByRole("button", { name: "Loads, complete" })).toBeTruthy();
    await waitFor(() =>
      expect(sent.at(-1)?.loads).toEqual([
        {
          id: "convection-1",
          type: "convection",
          name: "Convection 1",
          faces: [7],
          coefficient: { value: 25, unit: "W/(m²·°C)" },
          ambientTemperature: { value: 20, unit: "°C" },
        },
      ]),
    );

    fireEvent.click(tree().getByRole("button", { name: "Loads, complete" }));
    fireEvent.click(settings().getByRole("button", { name: "Add radiation" }));
    fireEvent.change(settings().getByLabelText("Emissivity"), { target: { value: "1.5" } });
    expect(settings().getByText("Enter a value above 0 and at most 1.")).toBeTruthy();
    fireEvent.change(settings().getByLabelText("Emissivity"), { target: { value: "1" } });
    fireEvent.change(settings().getByLabelText("Ambient temperature"), { target: { value: "20" } });
    // The same face as the convection: radiation and convection may share a face.
    expect(tree().getByRole("button", { name: "Radiation 1, complete" })).toBeTruthy();

    fireEvent.click(tree().getByRole("button", { name: "Loads, complete" }));
    fireEvent.click(settings().getByRole("button", { name: "Add heat generation" }));
    expect(settings().getByRole("checkbox", { name: "Body 1" })).toHaveProperty("checked", true);
    expect(settings().getByLabelText("Heat per volume unit")).toHaveProperty("value", "W/m³");
    fireEvent.change(settings().getByLabelText("Heat per volume"), { target: { value: "5000" } });
    expect(tree().getByRole("button", { name: "Heat generation 1, complete" })).toBeTruthy();
    fireEvent.click(settings().getByRole("checkbox", { name: "Body 1" }));
    expect(tree().getByRole("button", { name: "Heat generation 1, incomplete" })).toBeTruthy();
    await waitFor(() =>
      expect(sent.at(-1)?.loads.slice(1)).toEqual([
        {
          id: "radiation-1",
          type: "radiation",
          name: "Radiation 1",
          faces: [7],
          emissivity: 1,
          ambientTemperature: { value: 20, unit: "°C" },
        },
        { id: "heat_generation-1", type: "heat_generation", name: "Heat generation 1", bodies: [], power: { value: 5000, unit: "W/m³" } },
      ]),
    );
  });

  /** A thermal stress setup (M5.4): heated's temperatures on steel with every value, a fixed
   * support on face 7, stress-free at 20 °C. */
  const stressed: SimulationSpec = {
    ...heated,
    analysis: "thermal_stress",
    stressFreeTemperature: { value: 20, unit: "°C" },
    materials: [
      {
        ...thermalSpec.materials[0],
        youngsModulus: { value: 200, unit: "GPa" },
        poissonsRatio: 0.3,
        thermalExpansion: { value: 12, unit: "µm/(m·K)" },
      } as SimulationSpec["materials"][number],
    ],
    supports: [{ id: "fixed-1", type: "fixed", name: "Base", faces: [7] }],
  };

  it("sets up a thermal stress analysis with its stress-free temperature (M5.4)", async () => {
    const { sent, route } = saves();
    serve(routes([simulation({ ...stressed, stressFreeTemperature: null })], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Analysis, incomplete" }));
    expect(settings().getByRole("radio", { name: "Thermal stress" })).toHaveProperty("checked", true);
    expect(settings().getByText("Enter the stress-free temperature.")).toBeTruthy();
    // Supports and both kinds of load are offered; a uniform temperature change is not.
    expect(tree().getByRole("button", { name: "Base, complete" })).toBeTruthy();
    fireEvent.change(settings().getByLabelText("Stress-free temperature"), { target: { value: "20" } });
    await waitFor(() => expect(sent.at(-1)?.stressFreeTemperature).toEqual({ value: 20, unit: "°C" }));
    expect(tree().getByRole("button", { name: "Analysis, complete" })).toBeTruthy();
    fireEvent.click(tree().getByRole("button", { name: /^Loads,/ }));
    const adds = within(settings().getByRole("region", { name: "Loads" }))
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(adds).toContain("Add a pressure");
    expect(adds).toContain("Add a fixed temperature");
    expect(adds).not.toContain("Add a temperature change");
  });

  it("shows a thermal stress run's stresses and temperatures together (M5.4)", async () => {
    window.localStorage.clear();
    const result: SolveResult = {
      nodes: 7108,
      displacement: { max: { value: 2e-5, node: 4, position: [0.1, 0.05, 0.02] } },
      vonMises: {
        min: { value: 1e6, node: 3, position: [0.1, 0.05, 0] },
        max: { value: 150e6, node: 40, position: [0, 0, 0] },
      },
      reactions: [{ supportId: "fixed-1", force: [0, 0, 0], moment: [0, 0, 0], point: [0.1, 0.025, 0.01] }],
      loads: [],
      temperature: {
        min: { value: 293.15, node: 3, position: [0.1, 0.05, 0] },
        max: { value: 373.15, node: 40, position: [0, 0, 0] },
      },
      heatFlux: { max: { value: 4000, node: 12, position: [0.05, 0, 0] } },
      heatFlows: [
        { loadId: "fixed_temperature-1", heat: 25 },
        { loadId: "fixed_temperature-2", heat: -25 },
      ],
      heatBalance: { heatIn: 25, heatOut: 25, scale: 25, ratio: 0 },
      software: { calculix: "2.21" },
    };
    const fields = encodeFields(7, [
      { name: "displacement", kind: "length", components: 3, values: Array.from({ length: 21 }, (_, k) => (k % 3 === 0 ? 1e-5 : 0)) },
      { name: "vonMises", kind: "pressure", components: 1, values: Array.from({ length: 7 }, (_, v) => 1e6 + v * 1e6) },
      { name: "temperature", kind: "temperature", components: 1, values: Array.from({ length: 7 }, (_, v) => 293.15 + (80 * v) / 6) },
    ]);
    const routes_ = thermalRun();
    const runs = routes_["GET /api/simulations/s1/runs"] as { status: number; json: { runs: RunView[] } };
    const [first] = runs.json.runs;
    if (!first) throw new Error("no run");
    routes_["GET /api/simulations/s1/runs"] = { status: 200, json: { runs: [{ ...first, spec: stressed, result }] } };
    routes_["GET /api/runs/r1/fields"] = { status: 200, bytes: fields };
    serve(routes([simulation(stressed)], routes_));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    const legend = await screen.findByLabelText("Legend");
    expect(legend.textContent).toContain("Von Mises stress");
    // The temperature is one of the quantities, drawn on the deformed shape.
    const quantity = settings().getByLabelText("Quantity") as HTMLSelectElement;
    expect([...quantity.querySelectorAll("optgroup")].map((g) => g.label)).toContain("Temperature");
    fireEvent.change(quantity, { target: { value: "temperature" } });
    expect(legend.textContent).toContain("Temperature (°C)");
    expect(settings().getByLabelText("Shape")).toBeTruthy();
    const structural = within(settings().getByLabelText("Run results"));
    expect(structural.getByText("Largest von Mises stress").nextElementSibling?.textContent).toBe("150 MPa at (0, 0, 0) mm");
    const thermal = within(settings().getByLabelText("Thermal results"));
    expect(thermal.getByText("Highest temperature").nextElementSibling?.textContent).toBe("100 °C at (0, 0, 0) mm");
    expect(thermal.getByText("Heat flow, Hot").nextElementSibling?.textContent).toBe("25 W in");
    const exports = within(settings().getByRole("region", { name: "Export" }));
    expect(exports.getByRole("button", { name: "Reactions and loads (CSV)" })).toBeTruthy();
    expect(exports.getByRole("button", { name: "Heat flows (CSV)" })).toBeTruthy();
    expect(settings().queryByText(/pass|fail|complian/i)).toBeNull();
    window.localStorage.clear();
  });

  it("shows a thermal run's highest and lowest temperature and draws the temperature alone", async () => {
    window.localStorage.clear();
    serve(routes([simulation(heated)], thermalRun()));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    const legend = await screen.findByLabelText("Legend");
    expect(legend.textContent).toContain("Temperature (°C)");
    expect(legend.textContent).not.toContain("Deformed");
    expect(legend.textContent).not.toContain("Undeformed");
    // The bands run from 20 °C to 100 °C: the offset is applied, not just the factor.
    expect(legend.textContent).toContain("91.11 to 100");
    expect(legend.textContent).toContain("20 to 28.89");

    const quantity = settings().getByLabelText("Quantity") as HTMLSelectElement;
    expect(quantity.value).toBe("temperature");
    expect([...quantity.options].map((o) => o.textContent)).toEqual([
      "Temperature",
      "Heat flux magnitude",
      "Heat flux qx",
      "Heat flux qy",
      "Heat flux qz",
    ]);
    expect([...quantity.querySelectorAll("optgroup")].map((g) => g.label)).toEqual(["Temperature", "Heat flux"]);
    expect(settings().queryByLabelText("Shape")).toBeNull();

    const figures = within(settings().getByLabelText("Run results"));
    expect(figures.getByText("Highest temperature").nextElementSibling?.textContent).toBe("100 °C at (0, 0, 0) mm");
    expect(figures.getByText("Lowest temperature").nextElementSibling?.textContent).toBe("20 °C at (100, 50, 0) mm");
    expect(figures.queryByText(/displacement|von Mises|Reaction|Applied|safety factor/i)).toBeNull();

    // The units shown are the length, the temperature, the heat flux and the heat flow (M5.3);
    // kelvin and fahrenheit convert with their offsets.
    const units = within(settings().getByRole("group", { name: "Units shown" }));
    expect(units.getAllByRole("combobox").map((c) => c.closest("label")?.firstChild?.textContent)).toEqual([
      "Length",
      "Temperature",
      "Heat flux",
      "Heat flow",
    ]);
    fireEvent.change(settings().getByLabelText("Temperature"), { target: { value: "K" } });
    expect(legend.textContent).toContain("Temperature (K)");
    expect(figures.getByText("Highest temperature").nextElementSibling?.textContent).toBe("373.1 K at (0, 0, 0) mm");
    fireEvent.change(settings().getByLabelText("Temperature"), { target: { value: "°F" } });
    expect(figures.getByText("Lowest temperature").nextElementSibling?.textContent).toBe("68 °F at (100, 50, 0) mm");

    // The node values and the VTK file can be exported; there are no reactions to export.
    const exports = within(settings().getByRole("region", { name: "Export" }));
    expect(exports.getByRole("button", { name: "Results at every node (CSV)" })).toHaveProperty("disabled", false);
    expect(exports.getByRole("button", { name: "Mesh and results (VTK)" })).toHaveProperty("disabled", false);
    expect(exports.queryByRole("button", { name: "Reactions and loads (CSV)" })).toBeNull();
    expect(exports.getByRole("button", { name: "Heat flows (CSV)" })).toHaveProperty("disabled", false);
    expect(settings().queryByText(/pass|fail|complian/i)).toBeNull();
    window.localStorage.clear();
  });

  it("shows a thermal run's heat flux, each load's heat flow and the heat balance (M5.3)", async () => {
    window.localStorage.clear();
    serve(routes([simulation(heated)], thermalRun()));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    const legend = await screen.findByLabelText("Legend");
    const figures = within(settings().getByLabelText("Run results"));
    expect(figures.getByText("Largest heat flux").nextElementSibling?.textContent).toBe("4000 W/m² at (50, 0, 0) mm");
    expect(figures.getByText("Heat flow, Hot").nextElementSibling?.textContent).toBe("25 W in");
    expect(figures.getByText("Heat flow, Cold").nextElementSibling?.textContent).toBe("25 W out");
    expect(figures.getByText("Heat balance").nextElementSibling?.textContent).toBe("in 25 W, out 25 W");
    expect(figures.getByText("Out of balance").nextElementSibling?.textContent).toBe("0.0004 % of 25 W");

    // Heat flux along x, drawn in kW/m², and heat flows in BTU/h, without a rerun.
    fireEvent.change(settings().getByLabelText("Quantity"), { target: { value: "heatFluxX" } });
    expect(legend.textContent).toContain("Heat flux qx (W/m²)");
    fireEvent.change(settings().getByLabelText("Heat flux"), { target: { value: "kW/m²" } });
    expect(legend.textContent).toContain("Heat flux qx (kW/m²)");
    expect(figures.getByText("Largest heat flux").nextElementSibling?.textContent).toBe("4 kW/m² at (50, 0, 0) mm");
    fireEvent.change(settings().getByLabelText("Heat flow"), { target: { value: "BTU/h" } });
    expect(figures.getByText("Heat flow, Hot").nextElementSibling?.textContent).toBe("85.3 BTU/h in");
    expect(settings().queryByText(/pass|fail|complian/i)).toBeNull();
    window.localStorage.clear();
  });

  it("asks for a rerun to see heat flux on a thermal run solved before M5.3", async () => {
    window.localStorage.clear();
    serve(routes([simulation(heated)], thermalRun(true)));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    await screen.findByLabelText("Legend");
    const figures = within(settings().getByLabelText("Run results"));
    expect(figures.getByText("Heat flows").nextElementSibling?.textContent).toBe(
      "Run again to see the heat flux, each load's heat flow and the heat balance.",
    );
    fireEvent.change(settings().getByLabelText("Quantity"), { target: { value: "heatFlux" } });
    expect(await screen.findByText(/solved before ClearFEA kept heat fluxes/)).toBeTruthy();
    const exports = within(settings().getByRole("region", { name: "Export" }));
    expect(exports.getByRole("button", { name: "Heat flows (CSV)" })).toHaveProperty("disabled", true);
    window.localStorage.clear();
  });
});

describe("modal analysis (M6.1)", () => {
  /** The supported setup as a modal analysis: the density entered and the pressure deleted. */
  const modalSpec: SimulationSpec = {
    ...supported,
    analysis: "modal",
    modes: 4,
    loads: [],
    materials: [{ ...(supported.materials[0] as SimulationSpec["materials"][0]), density: { value: 7850, unit: "kg/m³" } }],
  };

  it("switches to a modal analysis with ten modes, marks the loads and asks the material for its density", async () => {
    const { sent, route } = saves();
    serve(routes([simulation(supported)], { "PUT /api/simulations/s1/spec": route }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Analysis, complete" }));
    fireEvent.click(settings().getByRole("radio", { name: "Modal" }));
    await waitFor(() => expect(sent.at(-1)?.analysis).toBe("modal"));
    expect(sent.at(-1)?.modes).toBe(10);
    expect((settings().getByLabelText("Number of modes") as HTMLInputElement).value).toBe("10");
    // The pressure stays, marked as having no effect; the support still holds the body.
    expect(tree().getByRole("button", { name: "Top, has a problem" })).toBeTruthy();
    expect(tree().getByRole("button", { name: "Base, complete" })).toBeTruthy();
    expect(tree().getByRole("button", { name: "Steel, incomplete" }).getAttribute("title")).toBe(
      "Enter the density; a modal analysis needs it for the mass.",
    );

    // Once its loads are deleted, a modal setup has no Loads group.
    fireEvent.click(tree().getByRole("button", { name: "Top, has a problem" }));
    fireEvent.click(settings().getByRole("button", { name: "Delete pressure" }));
    await waitFor(() => expect(sent.at(-1)?.loads).toEqual([]));
    expect(tree().queryByRole("button", { name: /^Loads,/ })).toBeNull();
  });

  it("estimates a modal run for its modes with SPOOLES and its modal limit (M6.3)", async () => {
    const spooles: SimulationSpec = { ...modalSpec, solver: "spooles" };
    const modal = { analysis: "modal", modes: 4 } as const;
    const fetchMock = serve(
      routes([simulation(spooles)], {
        "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh() } },
        "GET /api/simulations/s1/estimate?solver=spooles&analysis=modal&modes=4": {
          status: 200,
          json: { estimate: { ...ESTIMATE, solver: "spooles", ...modal } },
        },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^Run,/ }));
    const solver = (await settings().findByRole("combobox", { name: "Equation solver" })) as HTMLSelectElement;
    expect([...solver.options].map((o) => o.text)).toEqual([
      "PaStiX (direct, fastest), not for modal analysis",
      `SPOOLES (direct), up to ${maxElements("spooles", 2, modal).toLocaleString("en-US")} elements`,
      "Iterative Cholesky (iterative, least memory, less exact), not for modal analysis",
      "Iterative scaling (iterative, least memory, less exact), not for modal analysis",
    ]);
    expect(settings().getByText(/in a modal analysis of up to 100 modes/)).toBeTruthy();
    expect(await settings().findByText(/and 4 modes from the/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([path]) => path === "/api/simulations/s1/estimate?solver=spooles&analysis=modal&modes=4")).toBe(true);
  });

  it("shows a modal run's natural frequencies in display units and notes its rigid-body modes", async () => {
    window.localStorage.clear();
    const result: SolveResult = { nodes: 7108, frequencies: [-0.0021, 0.0008, 64.8335, 129.526], software: { calculix: "2.21" } };
    serve(
      routes([simulation(modalSpec)], {
        "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh() } },
        "GET /api/simulations/s1/runs": {
          status: 200,
          json: {
            runs: [
              run({
                spec: { ...modalSpec, solver: "spooles" },
                status: "succeeded",
                stage: null,
                result,
                files: ["deck.inp", "solver.log"],
                cost: { billedSeconds: 3, amount: 833, charged: true },
                finishedAt: "2026-10-16T12:01:00.000Z",
              }),
            ],
          },
        },
        "GET /api/runs/r1/log?after=0": { status: 200, json: { text: " Job finished\n", next: 1 } },
        "GET /api/runs/r1/log?after=1": { status: 200, json: { text: "", next: 1 } },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    const frequencies = within(await screen.findByLabelText("Natural frequencies"));
    // A table (M6.2): each row's mode, frequency and a choice of the mode shape drawn.
    const frequencyOf = (mode: number) =>
      frequencies.getByRole("radio", { name: `Show mode ${mode}` }).closest("tr")?.cells[1]?.textContent;
    expect(frequencies.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Mode", "Frequency (Hz)", "Shown"]);
    expect(frequencyOf(3)).toBe("64.83");
    expect(frequencyOf(4)).toBe("129.5");
    expect(settings().getByRole("note").textContent).toContain("rigid-body modes");
    // The first mode is shown; a row picks another.
    expect((frequencies.getByRole("radio", { name: "Show mode 1" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(frequencies.getByRole("radio", { name: "Show mode 3" }));
    expect((frequencies.getByRole("radio", { name: "Show mode 3" }) as HTMLInputElement).checked).toBe(true);
    // Its shape is drawn exaggerated or undeformed, never at a true scale, and can swing.
    const shapes = within(settings().getByRole("group", { name: "Mode shape on the model" }));
    const shape = shapes.getByLabelText("Shape") as HTMLSelectElement;
    expect([...shape.options].map((o) => o.value)).toEqual(["auto", "undeformed"]);
    const animate = shapes.getByLabelText("Animate") as HTMLInputElement;
    expect(animate.checked).toBe(false);
    fireEvent.click(animate);
    expect(animate.checked).toBe(true);
    fireEvent.change(shape, { target: { value: "undeformed" } });
    expect(animate.disabled).toBe(true);
    // No other quantity to draw, no static figures and no export.
    expect(settings().queryByLabelText("Quantity")).toBeNull();
    expect(settings().queryByRole("region", { name: "Export" })).toBeNull();
    expect(settings().queryByText(/von Mises|Reaction/)).toBeNull();
    const units = within(settings().getByRole("group", { name: "Units shown" }));
    expect(units.getAllByRole("combobox").map((c) => c.closest("label")?.firstChild?.textContent)).toEqual(["Frequency"]);
    fireEvent.change(settings().getByLabelText("Frequency"), { target: { value: "cpm" } });
    expect(frequencyOf(3)).toBe("3890");
    expect(frequencies.getByRole("columnheader", { name: "Frequency (cpm)" })).toBeTruthy();
    expect(settings().queryByText(/pass|fail|complian/i)).toBeNull();
    window.localStorage.clear();
  });
});

describe("report options (M7.1)", () => {
  const defaults = {
    sections: ["project", "geometry", "materials", "mesh", "loadsSupports", "solver", "results", "reactions", "extremes", "warnings"],
    views: [],
    titleBlock: { title: "Static structural", documentNumber: "", revision: "", preparedBy: "", checkedBy: "", approvedBy: "" },
    unitSystem: "metric-mm",
  };
  const view = (id: string, name: string, result: unknown) => ({
    id,
    name,
    settings: { camera: { position: [1, 1, 1], target: [0, 0, 0] }, hiddenBodies: [], result },
    updatedAt: "2026-10-17T00:00:00.000Z",
  });
  const views = [
    view("v1", "Front", null),
    view("v2", "Iso stress", { quantity: "vonMises", deformation: "auto", extremes: true, cut: null }),
  ];

  it("sets sections, views, the title block, the unit system and the company name, and saves them", async () => {
    const sentOptions: unknown[] = [];
    const sentBranding: unknown[] = [];
    serve(
      routes([simulation()], {
        "GET /api/simulations/s1/report-options": { status: 200, json: { options: defaults, saved: false, updatedAt: null } },
        "GET /api/report-branding": { status: 200, json: { branding: { companyName: "", logo: null } } },
        "GET /api/simulations/s1/views": { status: 200, json: { views } },
        "PUT /api/simulations/s1/report-options": (init) => {
          const options = JSON.parse(String(init?.body));
          sentOptions.push(options);
          return { status: 200, json: { options, saved: true, updatedAt: "2026-10-17T01:00:00.000Z" } };
        },
        "PUT /api/report-branding": (init) => {
          const body = JSON.parse(String(init?.body)) as { companyName: string };
          sentBranding.push(body);
          return { status: 200, json: { branding: { companyName: body.companyName, logo: null } } };
        },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Report, incomplete" }));
    expect(((await settings().findByLabelText("Report title")) as HTMLInputElement).value).toBe("Static structural");
    expect(settings().getByText("A report is made from a solved run. Its options can be set now.")).toBeTruthy();
    const save = settings().getByRole("button", { name: "Save report options" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(settings().getByRole("checkbox", { name: "Run warnings" }));
    fireEvent.click(await settings().findByRole("checkbox", { name: "Iso stress" }));
    fireEvent.click(settings().getByRole("checkbox", { name: "Front (geometry)" }));
    expect(settings().getByText("Drawn in the order picked: Iso stress, Front.")).toBeTruthy();
    fireEvent.change(settings().getByLabelText("Document number"), { target: { value: "CF-001" } });
    // The report prints in its own system (M7.6), starting as the project's.
    const reportUnits = settings().getByLabelText("Report unit system") as HTMLSelectElement;
    expect(reportUnits.value).toBe("metric-mm");
    fireEvent.change(reportUnits, { target: { value: "us-in" } });
    fireEvent.change(settings().getByLabelText("Company name"), { target: { value: "Acme Engineering" } });
    expect(settings().getByText("Unsaved changes.")).toBeTruthy();
    fireEvent.click(save);

    expect(await settings().findByText("Report options saved.")).toBeTruthy();
    expect(sentOptions).toEqual([
      {
        sections: defaults.sections.filter((s) => s !== "warnings"),
        views: ["v2", "v1"],
        titleBlock: { ...defaults.titleBlock, documentNumber: "CF-001" },
        unitSystem: "us-in",
      },
    ]);
    expect(sentBranding).toEqual([{ companyName: "Acme Engineering" }]);
    expect(save.disabled).toBe(true);
    expect(settings().queryByText(/pass|fail|complian/i)).toBeNull();
    // Figures (M7.2) are drawn from a solved run.
    expect(settings().getByText("Run the simulation to draw the figures. They are drawn from its latest solved run.")).toBeTruthy();
  });

  it("lists the figures stored for the latest solved run and asks for saved options before drawing (M7.2)", async () => {
    const figure = {
      kind: "support",
      item: "fixed-1",
      caption: "Base (fixed support)",
      position: 0,
      width: 1600,
      height: 1000,
      sizeBytes: 52000,
      createdAt: "2026-10-17T02:00:00.000Z",
    };
    serve(
      routes([simulation(supported)], {
        "GET /api/simulations/s1/runs": {
          status: 200,
          json: { runs: [run({ status: "succeeded", stage: null, finishedAt: "2026-10-17T01:00:00.000Z" })] },
        },
        "GET /api/runs/r1/log?after=0": { status: 200, json: { text: "", next: 0 } },
        "GET /api/simulations/s1/report-options": { status: 200, json: { options: defaults, saved: true, updatedAt: null } },
        "GET /api/report-branding": { status: 200, json: { branding: { companyName: "", logo: null } } },
        "GET /api/simulations/s1/views": { status: 200, json: { views } },
        "GET /api/runs/r1/figures": { status: 200, json: { figures: [figure] } },
        "GET /api/runs/r1/report": { status: 200, json: { report: null } },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Report, complete" }));
    const figures = within(await settings().findByRole("list", { name: "Figures" }));
    const image = figures.getByRole("img", { name: "Base (fixed support)" }) as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("/api/runs/r1/figures/support/fixed-1?v=2026-10-17T02%3A00%3A00.000Z");
    expect(figures.getByText("Base (fixed support)")).toBeTruthy();
    const draw = settings().getByRole("button", { name: "Draw the figures again" }) as HTMLButtonElement;
    expect(draw.disabled).toBe(false);
    fireEvent.click(settings().getByRole("checkbox", { name: "Run warnings" }));
    expect(draw.disabled).toBe(true);
    expect(settings().getByText("Save the report options first: the figures follow the saved ones.")).toBeTruthy();
  });

  it("makes the report of the latest solved run and offers its Word file and PDF for download (M7.3, M7.4)", async () => {
    const report = (status: string, extra: Record<string, unknown> = {}) => ({
      report: {
        id: "rep1",
        status,
        problem: null,
        sizeBytes: null,
        pdfSizeBytes: null,
        createdAt: "2026-10-17T04:00:00.000Z",
        finishedAt: null,
        ...extra,
      },
    });
    let checks = 0;
    const fetchMock = serve(
      routes([simulation(supported)], {
        "GET /api/simulations/s1/runs": {
          status: 200,
          json: { runs: [run({ status: "succeeded", stage: null, finishedAt: "2026-10-17T01:00:00.000Z" })] },
        },
        "GET /api/runs/r1/log?after=0": { status: 200, json: { text: "", next: 0 } },
        // Sections without figures, so the report is asked for without drawing any.
        "GET /api/simulations/s1/report-options": {
          status: 200,
          json: { options: { ...defaults, sections: ["project", "extremes"] }, saved: true, updatedAt: null },
        },
        "GET /api/report-branding": { status: 200, json: { branding: { companyName: "", logo: null } } },
        "GET /api/simulations/s1/views": { status: 200, json: { views } },
        "GET /api/runs/r1/figures": { status: 200, json: { figures: [] } },
        "GET /api/runs/r1/report": () => {
          checks += 1;
          if (checks === 1) return { status: 200, json: { report: null } };
          return {
            status: 200,
            json: report("succeeded", { sizeBytes: 245000, pdfSizeBytes: 142000, finishedAt: "2026-10-17T04:00:03.000Z" }),
          };
        },
        "POST /api/runs/r1/report": { status: 202, json: report("queued") },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Report, complete" }));
    const make = (await settings().findByRole("button", { name: "Make the report" })) as HTMLButtonElement;
    await waitFor(() => expect(make.disabled).toBe(false));
    fireEvent.click(make);
    expect(await settings().findByText("The report is waiting for the worker…")).toBeTruthy();
    expect(make.disabled).toBe(true);
    const link = (await settings().findByRole("link", { name: "Download the Word report" }, { timeout: 4000 })) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/api/runs/r1/report/docx?v=rep1");
    const pdf = settings().getByRole("link", { name: "Download the PDF report" }) as HTMLAnchorElement;
    expect(pdf.getAttribute("href")).toBe("/api/runs/r1/report/pdf?v=rep1");
    expect(settings().getByText(/\(245 kB\)/)).toBeTruthy();
    expect(settings().getByText(/\(142 kB\)/)).toBeTruthy();
    expect(make.disabled).toBe(false);
    expect(fetchMock.mock.calls.filter(([path]) => String(path).includes("/figures/")).length).toBe(0);
  });

  it("uploads a logo, shows it with its size, and removes it", async () => {
    const logo = { contentType: "image/png", sizeBytes: 900, width: 320, height: 80, updatedAt: "2026-10-17T01:00:00.000Z" };
    const fetchMock = serve(
      routes([simulation()], {
        "GET /api/simulations/s1/report-options": { status: 200, json: { options: defaults, saved: false, updatedAt: null } },
        "GET /api/report-branding": { status: 200, json: { branding: { companyName: "Acme", logo: null } } },
        "GET /api/simulations/s1/views": { status: 200, json: { views: [] } },
        "POST /api/report-branding/logo": { status: 200, json: { branding: { companyName: "Acme", logo } } },
        "DELETE /api/report-branding/logo": { status: 200, json: { branding: { companyName: "Acme", logo: null } } },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Report, incomplete" }));
    expect(await settings().findByText(/No saved views yet/)).toBeTruthy();
    expect(settings().getByText("No logo. A PNG or JPEG of at most 1 MB.")).toBeTruthy();
    const file = new File([new Uint8Array([0x89, 0x50])], "logo.png", { type: "image/png" });
    fireEvent.change(settings().getByLabelText("Upload a logo"), { target: { files: [file] } });
    expect(await settings().findByText("Logo uploaded.")).toBeTruthy();
    expect(settings().getByText("PNG, 320 × 80 pixels")).toBeTruthy();
    expect((settings().getByRole("img", { name: "Your logo" }) as HTMLImageElement).getAttribute("src")).toBe(
      "/api/report-branding/logo?v=2026-10-17T01%3A00%3A00.000Z",
    );
    const upload = fetchMock.mock.calls.find(([path]) => String(path) === "/api/report-branding/logo");
    expect(upload?.[1]?.body).toBe(file);
    fireEvent.click(settings().getByRole("button", { name: "Remove the logo" }));
    expect(await settings().findByText("Logo removed.")).toBeTruthy();
    expect(settings().queryByRole("img", { name: "Your logo" })).toBeNull();
  });
});
