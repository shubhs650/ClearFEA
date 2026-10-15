// SPDX-License-Identifier: AGPL-3.0-or-later
// The setup flow in the whole app (M1.5): start a simulation on a ready geometry, add a
// material, a fixed support and a pressure from the tree, and see each edit saved.

import type { GeometryView, MeshView, RunView, SimulationSpec, SimulationView, SolveResult } from "@clearfea/spec";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import type { ModelViewEvents } from "../src/viewer/ModelView";
import { readFixture } from "./fixtures";

// jsdom has no WebGL: a stand-in scene lets the test pick faces and see the selection.
const scene = vi.hoisted(() => ({ events: [] as ModelViewEvents[], selections: [] as number[][], edges: [] as string[] }));

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
    fireEvent.click(settings().getByRole("button", { name: "Add a material" }));
    expect(tree().getByRole("button", { name: "Material 1, incomplete" })).toBeTruthy();
    expect(settings().getByRole("checkbox", { name: "Body 1" })).toHaveProperty("checked", true);

    fireEvent.change(settings().getByLabelText("Young's modulus"), { target: { value: "200" } });
    fireEvent.change(settings().getByLabelText("Poisson's ratio"), { target: { value: "0.3" } });
    expect(await screen.findByRole("button", { name: "Material 1, complete" })).toBeTruthy();
    expect(tree().getByRole("button", { name: "Materials, complete" })).toBeTruthy();
    await waitFor(() => expect(sent.at(-1)?.materials[0]?.poissonsRatio).toBe(0.3));
    expect(sent.at(-1)?.materials).toEqual([
      {
        id: "material-1",
        name: "Material 1",
        model: "isotropic_elastic",
        youngsModulus: { value: 200, unit: "GPa" },
        poissonsRatio: 0.3,
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
    fireEvent.click(settings().getByRole("button", { name: "Add a material" }));
    fireEvent.change(settings().getByLabelText("Poisson's ratio"), { target: { value: "0.7" } });
    expect(settings().getByText("Enter a value above -1 and below 0.5.")).toBeTruthy();
    fireEvent.change(settings().getByLabelText("Young's modulus"), { target: { value: "-5" } });
    expect(settings().getByText("Enter a value greater than 0.")).toBeTruthy();
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(sent.at(-1)?.materials[0]).toMatchObject({ youngsModulus: null, poissonsRatio: null });
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
    await waitFor(() => expect(sent.at(-1)?.loads[0]?.magnitude).toEqual({ value: 2.5, unit: "MPa" }));
    expect(sent.at(-1)?.loads[0]?.faces).toEqual([7]);
    expect(sent.at(-1)?.supports).toEqual([{ id: "fixed-1", type: "fixed", name: "Fixed support 1", faces: [3] }]);

    // Opening the support again selects its faces in the viewer.
    fireEvent.click(tree().getByRole("button", { name: "Fixed support 1, complete" }));
    expect(scene.selections.at(-1)).toEqual([3]);
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
    fireEvent.click(settings().getByRole("button", { name: "Add a material" }));
    expect(await tree().findByText("Not saved: The setup cannot be saved: something.")).toBeTruthy();
  });
});

function mesh(overrides: Partial<MeshView> = {}): MeshView {
  return {
    id: "m1",
    geometryId: "g1",
    size: { value: 5, unit: "mm" },
    order: 2,
    status: "ready",
    problem: null,
    nodeCount: 7108,
    elementCount: 4000,
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
    expect(scene.edges.at(-1)).toBe("elements");
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
    expect(settings().getByText("The mesh size changed after the mesh was made. Generate the mesh again.")).toBeTruthy();
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

function run(overrides: Partial<RunView> = {}): RunView {
  return {
    id: "r1",
    simulationId: "s1",
    meshId: "m1",
    status: "solving",
    stage: "queued",
    problem: null,
    result: null,
    createdAt: "2026-10-15T12:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

const supported: SimulationSpec = {
  ...meshed,
  supports: [{ id: "fixed-1", type: "fixed", name: "Base", faces: [3] }],
};

describe("run", () => {
  it("waits for a current mesh, then solves and shows the solver log", async () => {
    serve(routes([simulation(supported)]));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, incomplete" }));
    expect(settings().getByRole("button", { name: "Run" })).toHaveProperty("disabled", true);
    expect(settings().getByText("Generate the mesh first.")).toBeTruthy();
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
    fireEvent.click(button);
    expect(await settings().findByText("Waiting for the solver…")).toBeTruthy();
    expect(await settings().findByText("CalculiX Version 2.21")).toBeTruthy();
    expect(settings().getByRole("button", { name: "Run again" })).toHaveProperty("disabled", true);
    expect(tree().getByRole("button", { name: "Run, incomplete" }).getAttribute("title")).toBe(
      "The simulation is being solved.",
    );
    expect(fetchMock.mock.calls.some(([path, init]) => path === "/api/simulations/s1/runs" && init?.method === "POST")).toBe(true);
  });

  it("shows a finished run's figures in display units, with numbers only", async () => {
    const result: SolveResult = {
      nodes: 7108,
      displacement: { max: { value: 1.2e-4, node: 17, position: [0.1, 0.05, 0.02] } },
      vonMises: {
        min: { value: 1.5e3, node: 3, position: [0, 0.05, 0] },
        max: { value: 2.4e8, node: 40, position: [0, 0, 0] },
      },
      reactions: [{ supportId: "fixed-1", force: [0, 0, -400] }],
      software: { calculix: "2.21" },
    };
    serve(
      routes([simulation(supported)], {
        "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh() } },
        "GET /api/simulations/s1/runs": {
          status: 200,
          json: { runs: [run({ status: "succeeded", stage: null, result, finishedAt: "2026-10-15T12:01:00.000Z" })] },
        },
        "GET /api/runs/r1/log?after=0": { status: 200, json: { text: " Job finished\n", next: 1 } },
        "GET /api/runs/r1/log?after=1": { status: 200, json: { text: "", next: 1 } },
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    const figures = within(settings().getByLabelText("Run results"));
    expect(figures.getByText("0.12 mm")).toBeTruthy();
    expect(figures.getByText("at (100, 50, 20) mm")).toBeTruthy();
    expect(figures.getByText("240 MPa")).toBeTruthy();
    expect(figures.getByText("0.0015 MPa")).toBeTruthy();
    expect(figures.getByText("Reaction, Base")).toBeTruthy();
    expect(figures.getByText("(0, 0, -400) N")).toBeTruthy();
    expect(settings().queryByText(/pass|fail|complian/i)).toBeNull();
    expect(settings().getByRole("button", { name: "Run again" })).toHaveProperty("disabled", false);
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
