// SPDX-License-Identifier: AGPL-3.0-or-later
// The page a read-only share link opens (M8.7, ADR-083): the run's results read through the link
// alone, with nothing that changes data, and a plain message when the link no longer works.

import type { SharedRunResponse, SimulationSpec } from "@clearfea/spec";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shareTokenOf } from "../src/api/shareLinks";
import { SharedRunPage } from "../src/share/SharedRunPage";
import { readFixture } from "./fixtures";
import { twoFacesFields } from "./resultFiles";

vi.mock("../src/viewer/ModelView", () => ({
  ModelView: class {
    setMesh() {}
    setSelection() {}
    setEdges() {}
    setEdgeSelection() {}
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
    fitView() {}
    setDisplayStyle() {}
    onCamera() {
      return () => {};
    }
    dispose() {}
  },
}));

const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";

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
    type: "plane",
    gmshType: "Plane",
    area: 0.005,
    centroid: [0.05, 0.025, 0],
    bbox: [0, 0, 0, 0.1, 0.05, 0],
    bodies: [1],
  })),
};

const spec: SimulationSpec = {
  version: 1,
  analysis: "linear_static",
  geometryId: "g1",
  bodies: [{ tag: 1, material: "material-1" }],
  materials: [
    { id: "material-1", name: "Steel", model: "isotropic_elastic", youngsModulus: { value: 200, unit: "GPa" }, poissonsRatio: 0.3 },
  ],
  supports: [{ id: "fixed-1", type: "fixed", name: "Base", faces: [3] }],
  loads: [{ id: "pressure-1", type: "pressure", name: "Top", faces: [7], magnitude: { value: 1, unit: "MPa" } }],
  mesh: { size: { value: 5, unit: "mm" } },
  solver: "pastix",
};

const shared: SharedRunResponse = {
  run: {
    id: "r1",
    spec,
    mesh: { size: { value: 5, unit: "mm" }, order: 2, nodeCount: 7108, elementCount: 4000 },
    software: { clearfea: "0.0.0+d9d394b", deckFormat: 1, calculix: "2.21", gmsh: "4.15.2", occt: "7.9.0" },
    status: "succeeded",
    result: {
      nodes: 7108,
      displacement: { max: { value: 1.2e-4, node: 17, position: [0.1, 0.05, 0.02] } },
      vonMises: {
        min: { value: 1.5e3, node: 3, position: [0, 0.05, 0] },
        max: { value: 2.4e8, node: 40, position: [0, 0, 0] },
      },
      reactions: [{ supportId: "fixed-1", force: [0, 0, -400] }],
      software: { calculix: "2.21" },
    },
    createdAt: "2026-10-15T12:00:00.000Z",
    finishedAt: "2026-10-15T12:01:00.000Z",
  },
  simulationName: "Bracket under pressure",
  unitSystem: "metric-mm",
};

type Reply = { status: number; json?: unknown; bytes?: ArrayBuffer };

function serve(routes: Record<string, Reply>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    const reply = routes[key];
    if (reply === undefined) throw new Error(`Unexpected request ${key}`);
    const body = reply.bytes ?? (reply.json === undefined ? null : JSON.stringify(reply.json));
    return new Response(body, { status: reply.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const HEALTH = { status: 200, json: { status: "ok", database: "ok", storage: "ok", commit: "development" } };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("a shared run's page", () => {
  it("shows the run's results read through the link, and nothing to change", async () => {
    const fetchMock = serve({
      "GET /api/health": HEALTH,
      [`GET /api/shared/${TOKEN}`]: { status: 200, json: shared },
      [`GET /api/shared/${TOKEN}/topology`]: { status: 200, json: topology },
      [`GET /api/shared/${TOKEN}/surface`]: { status: 200, bytes: readFixture("display-two-faces.bin") },
      [`GET /api/shared/${TOKEN}/fields`]: { status: 200, bytes: twoFacesFields() },
    });
    render(<SharedRunPage token={TOKEN} />);
    const record = within(await screen.findByRole("navigation", { name: "Shared run" }));
    expect(record.getByText("Bracket under pressure")).toBeTruthy();
    expect(record.getByText(/Read-only/)).toBeTruthy();
    expect(record.getByText("Linear static")).toBeTruthy();
    const results = within(screen.getByRole("complementary", { name: "Results" }));
    expect(within(results.getByLabelText("Run results")).getByText("240 MPa")).toBeTruthy();
    expect((await screen.findByLabelText("Legend")).textContent).toContain("Von Mises stress (MPa)");
    // The quantity and units can be changed for this page only.
    fireEvent.change(results.getByLabelText("Quantity"), { target: { value: "displacement" } });
    await waitFor(() => expect(screen.getByLabelText("Legend").textContent).toContain("Displacement"));
    // Nothing on the page edits, runs or shares; only the link's routes were read.
    expect(screen.queryByRole("button", { name: /^Run/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "Share" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Views" })).toBeNull();
    const paths = fetchMock.mock.calls.map(([path]) => String(path));
    expect(paths.filter((path) => path !== "/api/health").every((path) => path.startsWith(`/api/shared/${TOKEN}`))).toBe(true);
  });

  it("says plainly when the link does not work", async () => {
    serve({
      "GET /api/health": HEALTH,
      [`GET /api/shared/${TOKEN}`]: {
        status: 404,
        json: { error: "This share link does not work: it was revoked by the person who shared it, or it is not complete. Ask them for a new link." },
      },
    });
    render(<SharedRunPage token={TOKEN} />);
    expect((await screen.findByRole("alert")).textContent).toContain("This share link does not work");
    expect(screen.queryByRole("navigation", { name: "Shared run" })).toBeNull();
  });
});

describe("the share link's address", () => {
  it("names the token of a shared run's page and nothing else", () => {
    expect(shareTokenOf(`/share/${TOKEN}`)).toBe(TOKEN);
    expect(shareTokenOf(`/share/${TOKEN}/`)).toBe(TOKEN);
    expect(shareTokenOf("/")).toBeNull();
    expect(shareTokenOf("/share/")).toBeNull();
    expect(shareTokenOf(`/share/${TOKEN}/more`)).toBeNull();
  });
});
