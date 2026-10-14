// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

function respondWith(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("layout shell", () => {
  it("shows the tree, viewer, settings panel and status bar", () => {
    respondWith(200, { status: "ok", database: "ok", storage: "ok" });
    render(<App />);
    expect(screen.getByRole("navigation", { name: "Simulation tree" })).toBeTruthy();
    expect(screen.getByRole("main", { name: "3D viewer" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("contentinfo", { name: "Status" })).toBeTruthy();
  });
});

describe("status bar", () => {
  it("reports a healthy API", async () => {
    respondWith(200, { status: "ok", database: "ok", storage: "ok" });
    render(<App />);
    expect(await screen.findByText("API connected")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith("/api/health", expect.anything());
  });

  it("shows the API's own fix when it is degraded", async () => {
    const problem = "The database has no tables yet. Run the migration and restart the API.";
    respondWith(503, { status: "degraded", database: problem, storage: "ok" });
    render(<App />);
    expect(await screen.findByText("API running with problems")).toBeTruthy();
    expect(screen.getByText(problem)).toBeTruthy();
  });

  it("tells the user how to start the API when nothing answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    render(<App />);
    expect(await screen.findByText("API not reachable")).toBeTruthy();
    expect(screen.getByText(/pnpm --filter @clearfea\/api dev/)).toBeTruthy();
  });

  it("treats a network error as unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<App />);
    expect(await screen.findByText("API not reachable")).toBeTruthy();
  });
});
