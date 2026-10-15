// SPDX-License-Identifier: AGPL-3.0-or-later
// The setup flow in the whole app (M1.5): start a simulation on a ready geometry, add a
// material, a fixed support and a pressure from the tree, and see each edit saved.

import {
  type GeometryView,
  type IsotropicMaterial,
  type MeshQuality,
  type MeshView,
  materialLibrary,
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
import { twoFacesFields } from "./resultFiles";

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
    "GET /api/simulations/s1/estimate": { status: 200, json: { estimate: ESTIMATE } },
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
    spec: supported,
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

/** Routes of a setup whose run has succeeded, with its result files. */
function finishedRun(): Record<string, Route> {
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
  return {
    "GET /api/simulations/s1/mesh": { status: 200, json: { mesh: mesh() } },
    "GET /api/simulations/s1/runs": {
      status: 200,
      json: {
        runs: [
          run({
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
    "GET /api/runs/r1/fields": { status: 200, bytes: twoFacesFields() },
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
        "GET /api/simulations/s1/estimate": { status: 200, json: { estimate: tight } },
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
        "The estimate needs more memory than this size has, so the run may stop for lack of memory. The recommended size is medium.",
      ),
    ).toBeTruthy();
    const button = settings().getByRole("button", { name: "Run" });
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    fireEvent.click(button);
    expect(await settings().findByText("Waiting for the solver…")).toBeTruthy();
    const post = fetchMock.mock.calls.find(([path, init]) => path === "/api/simulations/s1/runs" && init?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({ machineSize: "small" });
  });

  it("shows a finished run's figures in display units, with numbers only", async () => {
    serve(routes([simulation(supported)], finishedRun()));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Run, complete" }));
    // The viewer shows the results: von Mises on the exaggerated deformed shape by default.
    const legend = await screen.findByLabelText("Legend");
    expect(legend.textContent).toContain("Von Mises stress (MPa)");
    expect(legend.textContent).toContain("Deformed shape, scale ×5");
    fireEvent.change(settings().getByLabelText("Quantity"), { target: { value: "displacement" } });
    fireEvent.change(settings().getByLabelText("Shape"), { target: { value: "undeformed" } });
    expect(legend.textContent).toContain("Displacement magnitude (mm)");
    expect(legend.textContent).toContain("Undeformed shape");
    const figures = within(settings().getByLabelText("Run results"));
    expect(figures.getByText("0.12 mm")).toBeTruthy();
    expect(figures.getByText("at (100, 50, 20) mm")).toBeTruthy();
    expect(figures.getByText("240 MPa")).toBeTruthy();
    expect(figures.getByText("0.0015 MPa")).toBeTruthy();
    expect(figures.getByText("Reaction, Base")).toBeTruthy();
    expect(figures.getByText("(0, 0, -400) N")).toBeTruthy();
    expect(within(settings().getByLabelText("Run record")).getByText("0.003611 credits for 13 s")).toBeTruthy();
    expect(settings().queryByText(/pass|fail|complian/i)).toBeNull();
    expect(settings().getByRole("button", { name: "Run again" })).toHaveProperty("disabled", false);
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
