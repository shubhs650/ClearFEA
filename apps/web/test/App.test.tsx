// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

type Reply = { status: number; body?: unknown } | Error;
type Routes = Record<string, Reply | (() => Reply)>;

const healthy = { status: 200, body: { status: "ok", database: "ok", storage: "ok" } };
const alice = { id: "a", login: "alice", name: "Alice (test user)" };
const signedIn = { status: 200, body: { user: alice } };
const signedOut = { status: 401, body: { error: "You are not signed in." } };
const noGeometries = { status: 200, body: { geometries: [] } };

function job(status: string) {
  return {
    id: "j1",
    type: "noop",
    targetId: null,
    status,
    stage: null,
    failureCategory: null,
    failureCause: null,
    failureMessage: null,
    createdAt: "2026-10-14T12:00:00.000Z",
    claimedAt: null,
    finishedAt: null,
  };
}

/** Answers fetch calls by "METHOD /path"; anything not listed is a test error. */
function serve(routes: Routes) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    const route = routes[key];
    if (route === undefined) throw new Error(`Unexpected request ${key}`);
    const reply = typeof route === "function" ? route() : route;
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("sign-in", () => {
  it("shows the sign-in form when nobody is signed in", async () => {
    serve({ "GET /api/health": healthy, "GET /api/session": signedOut });
    render(<App />);
    expect(await screen.findByRole("main", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByLabelText("Login")).toBeTruthy();
  });

  it("opens the layout shell after a correct sign-in", async () => {
    const fetchMock = serve({
      "GET /api/health": healthy,
      "GET /api/session": signedOut,
      "POST /api/session": signedIn,
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries": noGeometries,
    });
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Login"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "alice-local" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Signed in as Alice (test user)")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/session",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ login: "alice", password: "alice-local" }),
      }),
    );
  });

  it("shows the API's message for a wrong password", async () => {
    const message = "The login or password is wrong. Check both and try again.";
    serve({
      "GET /api/health": healthy,
      "GET /api/session": signedOut,
      "POST /api/session": { status: 401, body: { error: message } },
    });
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Login"), { target: { value: "alice" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("returns to the sign-in form after signing out", async () => {
    serve({
      "GET /api/health": healthy,
      "GET /api/session": signedIn,
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries": noGeometries,
      "DELETE /api/session": { status: 204 },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("main", { name: "Sign in" })).toBeTruthy();
  });
});

describe("layout shell", () => {
  it("shows the tree, viewer, settings panel and status bar", async () => {
    serve({
      "GET /api/health": healthy,
      "GET /api/session": signedIn,
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries": noGeometries,
    });
    render(<App />);
    expect(await screen.findByRole("navigation", { name: "Simulation tree" })).toBeTruthy();
    expect(screen.getByRole("main", { name: "3D viewer" })).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("contentinfo", { name: "Status" })).toBeTruthy();
  });
});

describe("worker check", () => {
  it("queues a no-op job and follows it to succeeded", async () => {
    let jobs: unknown[] = [];
    serve({
      "GET /api/health": healthy,
      "GET /api/session": signedIn,
      "GET /api/jobs": () => ({ status: 200, body: { jobs } }),
      "GET /api/geometries": noGeometries,
      "POST /api/jobs": () => {
        jobs = [job("queued")];
        return { status: 201, body: { job: job("queued") } };
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Queue a no-op job" }));
    expect(await screen.findByText("Queued")).toBeTruthy();
    // The worker finishes the job; the next poll shows it.
    jobs = [job("succeeded")];
    expect(await screen.findByText("Succeeded", {}, { timeout: 4000 })).toBeTruthy();
  });

  it("goes back to sign-in when the session has expired", async () => {
    serve({
      "GET /api/health": healthy,
      "GET /api/session": signedIn,
      "GET /api/jobs": { status: 401, body: { error: "Your sign-in has expired. Sign in again." } },
      "GET /api/geometries": noGeometries,
    });
    render(<App />);
    expect(await screen.findByRole("main", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Your sign-in has expired. Sign in again.");
  });
});

describe("status bar", () => {
  it("reports a healthy API", async () => {
    serve({ "GET /api/health": healthy, "GET /api/session": signedOut });
    render(<App />);
    expect(await screen.findByText("API connected")).toBeTruthy();
  });

  it("shows the API's own fix when it is degraded", async () => {
    const problem = "The database has no tables yet. Run the migration and restart the API.";
    serve({
      "GET /api/health": { status: 503, body: { status: "degraded", database: problem, storage: "ok" } },
      "GET /api/session": signedOut,
    });
    render(<App />);
    expect(await screen.findByText("API running with problems")).toBeTruthy();
    expect(screen.getByText(problem)).toBeTruthy();
  });

  it("tells the user how to start the API when nothing answers", async () => {
    serve({ "GET /api/health": { status: 500 }, "GET /api/session": { status: 500 } });
    render(<App />);
    expect(await screen.findByText("API not reachable")).toBeTruthy();
    expect(screen.getAllByText(/pnpm --filter @clearfea\/api dev/).length).toBeGreaterThan(0);
  });

  it("treats a network error as unreachable", async () => {
    const down = new TypeError("Failed to fetch");
    serve({ "GET /api/health": down, "GET /api/session": down });
    render(<App />);
    expect(await screen.findByText("API not reachable")).toBeTruthy();
  });
});
