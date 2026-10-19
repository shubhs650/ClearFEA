// SPDX-License-Identifier: AGPL-3.0-or-later
import type { GeometryView } from "@clearfea/spec";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeometryPanel } from "../src/geometry/GeometryPanel";

type Reply = { status: number; body?: unknown };

function geometry(overrides: Partial<GeometryView> = {}): GeometryView {
  return {
    id: "g1",
    name: "bracket.step",
    sizeBytes: 1000,
    status: "unconfirmed",
    problem: null,
    declaredUnit: "SI_UNIT(.MILLI.,.METRE.)",
    detectedUnit: "mm",
    unitProblem: null,
    readingFactor: 0.001,
    scaling: 1,
    confirmedUnit: null,
    unitLocked: false,
    bodyCount: 1,
    faceCount: 7,
    size: 0.1136,
    bbox: [0, 0, 0, 0.1, 0.05, 0.02],
    createdAt: "2026-10-14T12:00:00.000Z",
    ...overrides,
  };
}

/** Answers fetch calls by "METHOD /path" and records each request's init. */
function serve(routes: Record<string, Reply | ((init?: RequestInit) => Reply)>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    const route = routes[key];
    if (route === undefined) throw new Error(`Unexpected request ${key}`);
    const reply = typeof route === "function" ? route(init) : route;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ok = (g: GeometryView) => ({ status: 200, body: { geometry: g } });

describe("geometry panel", () => {
  it("uploads the chosen file as the raw request body", async () => {
    const fetchMock = serve({
      "GET /api/geometries": { status: 200, body: { geometries: [] } },
      "POST /api/geometries?name=my%20part.step": {
        status: 201,
        body: { geometry: geometry({ status: "importing", name: "my part.step" }) },
      },
    });
    render(<GeometryPanel onSignedOut={() => {}} />);
    expect(await screen.findByText("Upload a STEP file to start.")).toBeTruthy();
    const file = new File(["ISO-10303-21;"], "my part.step");
    fireEvent.change(screen.getByLabelText("Upload a STEP file"), { target: { files: [file] } });
    expect(await screen.findByText("Importing")).toBeTruthy();
    const init = fetchMock.mock.calls[1]?.[1];
    expect(init?.body).toBe(file);
    expect(init?.headers).toEqual({ "Content-Type": "application/octet-stream" });
  });

  it("says a solver machine is starting while the import waits for one on the live site", async () => {
    let starting = true;
    serve({
      "GET /api/geometries": { status: 200, body: { geometries: [geometry({ status: "importing" })] } },
      "GET /api/jobs/machine-wait": () => ({ status: 200, body: { machineStarting: starting } }),
    });
    render(<GeometryPanel onSignedOut={() => {}} />);
    const note = await screen.findByRole("status", { name: "Solver machine" });
    expect(note.textContent).toContain("Starting a solver machine. After a break this takes 1 to 3 minutes");
    starting = false;
    cleanup();
    render(<GeometryPanel onSignedOut={() => {}} />);
    expect(await screen.findByText("Importing")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("status", { name: "Solver machine" })).toBeNull();
  });

  it("shows the detected unit with the size it gives, and confirms it", async () => {
    const fetchMock = serve({
      "GET /api/geometries": { status: 200, body: { geometries: [geometry()] } },
      "POST /api/geometries/g1/unit": ok(geometry({ status: "ready", confirmedUnit: "mm" })),
    });
    render(<GeometryPanel onSignedOut={() => {}} />);
    expect(await screen.findByText(/which makes the part 100 × 50 × 20 mm/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm unit" }));
    expect(await screen.findByText("Ready")).toBeTruthy();
    expect(screen.getByText("100 × 50 × 20 mm")).toBeTruthy();
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ unit: "mm" }));
  });

  it("asks for a unit when the file has none, showing its raw coordinates", async () => {
    const bare = geometry({
      status: "needs_unit",
      declaredUnit: null,
      detectedUnit: null,
      unitProblem: "The file does not declare a length unit.",
      readingFactor: 1,
      bbox: [0, 0, 0, 100, 50, 20],
    });
    const fetchMock = serve({
      "GET /api/geometries": { status: 200, body: { geometries: [bare] } },
      "POST /api/geometries/g1/unit": ok(geometry({ status: "importing", confirmedUnit: "in" })),
    });
    render(<GeometryPanel onSignedOut={() => {}} />);
    expect(await screen.findByText(/Its coordinates span 100 × 50 × 20/)).toBeTruthy();
    const button = screen.getByRole("button", { name: "Confirm unit" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Length unit of the file"), { target: { value: "in" } });
    fireEvent.click(button);
    expect(await screen.findByText("Importing")).toBeTruthy();
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ unit: "in" }));
  });

  it("shows a locked unit without a way to change it", async () => {
    const used = geometry({ status: "ready", confirmedUnit: "mm", unitLocked: true });
    serve({ "GET /api/geometries": { status: 200, body: { geometries: [used] } } });
    render(<GeometryPanel onSignedOut={() => {}} />);
    expect(await screen.findByText(/The unit is mm and is locked, because a simulation uses/)).toBeTruthy();
    expect(screen.queryByLabelText("Length unit of the file")).toBeNull();
    expect(screen.queryByRole("button", { name: "Change unit" })).toBeNull();
  });

  it("shows why an import failed", async () => {
    serve({
      "GET /api/geometries": {
        status: 200,
        body: {
          geometries: [
            geometry({ status: "failed", problem: "The file contains no solid bodies.", bbox: null }),
          ],
        },
      },
    });
    render(<GeometryPanel onSignedOut={() => {}} />);
    expect((await screen.findByRole("alert")).textContent).toBe("The file contains no solid bodies.");
    expect(screen.queryByRole("button", { name: "Confirm unit" })).toBeNull();
  });

  it("shows the API's message when an upload is refused", async () => {
    const message = "This is not a STEP file: it does not start with ISO-10303-21.";
    serve({
      "GET /api/geometries": { status: 200, body: { geometries: [] } },
      "POST /api/geometries?name=cube.stl": { status: 400, body: { error: message } },
    });
    render(<GeometryPanel onSignedOut={() => {}} />);
    const input = await screen.findByLabelText("Upload a STEP file");
    fireEvent.change(input, { target: { files: [new File(["solid"], "cube.stl")] } });
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });
});
