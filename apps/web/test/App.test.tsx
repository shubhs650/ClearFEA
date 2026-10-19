// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

type Reply = { status: number; body?: unknown } | Error;
type Routes = Record<string, Reply | (() => Reply)>;

const healthy = { status: 200, body: { status: "ok", database: "ok", storage: "ok", commit: "development" } };
const alice = { id: "a", login: "alice", name: "Alice (test user)", admin: false };
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

/**
 * Answers fetch calls by "METHOD /path"; anything not listed is a test error. The sign-in screen
 * asks how to sign in; it is the password form unless a test says otherwise.
 */
function serve(listed: Routes) {
  const routes: Routes = { "GET /api/session/options": { status: 200, body: { signIn: "password" } }, ...listed };
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

describe("Google sign-in (M10.3)", () => {
  const google = { status: 200, body: { signIn: "google" } };

  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("offers only Sign in with Google on the live site, and goes to Google", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, href: window.location.href, assign });
    const fetchMock = serve({
      "GET /api/health": healthy,
      "GET /api/session": signedOut,
      "GET /api/session/options": google,
      "POST /api/auth/sign-in/social": {
        status: 200,
        body: { url: "https://accounts.google.com/o/oauth2/v2/auth?state=s", redirect: true },
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));
    expect(screen.queryByLabelText("Password")).toBeNull();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?state=s"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/sign-in/social",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ provider: "google", callbackURL: "/app", errorCallbackURL: "/app" }),
      }),
    );
  });

  it("says why Google sign-in was refused, and takes the code out of the address", async () => {
    window.history.replaceState(null, "", "/app?error=NOT_INVITED&error_description=x");
    serve({ "GET /api/health": healthy, "GET /api/session": signedOut, "GET /api/session/options": google });
    render(<App />);
    expect((await screen.findByRole("alert")).textContent).toContain("not invited to the ClearFEA closed beta");
    expect(window.location.search).toBe("");
  });

  it("does not repeat an unexpected error text from the address", async () => {
    window.history.replaceState(null, "", "/app?error=Call%20this%20number");
    serve({ "GET /api/health": healthy, "GET /api/session": signedOut, "GET /api/session/options": google });
    render(<App />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Google sign-in did not finish.");
    expect(alert.textContent).not.toContain("number");
  });
});

describe("admin page (M10.3)", () => {
  const admin = { status: 200, body: { user: { ...alice, admin: true } } };
  const view = (allowed: string[], largeOn = false, hoursCap = 60) => ({
    status: 200,
    body: {
      adminEmail: "alice@clearfea.test",
      allowed: allowed.map((email) => ({ email, addedAt: "2026-10-19T06:00:00.000Z" })),
      users: [
        {
          id: "a",
          name: "Alice (test user)",
          email: "alice@clearfea.test",
          createdAt: "2026-10-19T05:00:00.000Z",
          lastSignIn: null,
          machineSecondsThisMonth: 3900,
          allowed: true,
        },
      ],
      machines: "cloud",
      cloudSizes: [
        { name: "medium", cores: 4, memoryBytes: 17179869184, enabled: true, default: true },
        { name: "large", cores: 8, memoryBytes: 34359738368, enabled: largeOn, default: false },
      ],
      solverMachines: {
        launcher: "ready",
        problem: null,
        hoursThisMonth: 2.25,
        hoursCap,
        starts: [
          { size: "medium", requestedAt: "2026-10-19T07:00:00.000Z", state: "running", problem: null },
          {
            size: "medium",
            requestedAt: "2026-10-19T06:00:00.000Z",
            state: "failed",
            problem: "AWS refused RunTask: AccessDeniedException: not authorized",
          },
        ],
      },
    },
  });

  it("is offered to the admin only", async () => {
    serve({
      "GET /api/health": healthy,
      "GET /api/session": signedIn,
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries": noGeometries,
    });
    render(<App />);
    expect(await screen.findByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
  });

  it("adds and removes an allowed address", async () => {
    const fetchMock = serve({
      "GET /api/health": healthy,
      "GET /api/session": admin,
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries": noGeometries,
      "GET /api/admin": view([]),
      "POST /api/admin/allowed": view(["colleague@gmail.com"]),
      "DELETE /api/admin/allowed/colleague%40gmail.com": view([]),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Admin" }));
    const page = await screen.findByRole("region", { name: "Admin" });
    expect(await within(page).findByText("Nobody else is invited yet.")).toBeTruthy();
    expect(within(page).getByText("1 h 05 min")).toBeTruthy();
    fireEvent.change(within(page).getByLabelText("Email address"), { target: { value: "colleague@gmail.com" } });
    fireEvent.click(within(page).getByRole("button", { name: "Add" }));
    expect(await within(page).findByText("colleague@gmail.com")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/allowed",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "colleague@gmail.com" }) }),
    );
    fireEvent.click(within(page).getByRole("button", { name: "Remove colleague@gmail.com" }));
    expect(await within(page).findByText("Nobody else is invited yet.")).toBeTruthy();
    fireEvent.click(within(page).getByRole("button", { name: "Back to the workbench" }));
    expect(screen.queryByRole("region", { name: "Admin" })).toBeNull();
  });

  it("switches the large machine size on, and keeps the default size on (M10.6)", async () => {
    const fetchMock = serve({
      "GET /api/health": healthy,
      "GET /api/session": admin,
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries": noGeometries,
      "GET /api/admin": view([]),
      "PUT /api/admin/machine-sizes/large": view([], true),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Admin" }));
    const sizes = await screen.findByRole("region", { name: "Machine sizes" });
    const medium = within(sizes).getByRole("checkbox", { name: "medium" }) as HTMLInputElement;
    const large = within(sizes).getByRole("checkbox", { name: "large" }) as HTMLInputElement;
    expect(medium.checked && medium.disabled).toBe(true);
    expect(within(sizes).getByText("8 vCPU, 32 GB")).toBeTruthy();
    expect(large.checked).toBe(false);
    fireEvent.click(large);
    await waitFor(() => expect(large.checked).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/machine-sizes/large",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ enabled: true }) }),
    );
  });

  it("shows the solver machines and sets the monthly hours limit (M10.7)", async () => {
    const fetchMock = serve({
      "GET /api/health": healthy,
      "GET /api/session": admin,
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries": noGeometries,
      "GET /api/admin": view([]),
      "PUT /api/admin/machine-hours-cap": view([], false, 0),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Admin" }));
    const machines = await screen.findByRole("region", { name: "Solver machines" });
    expect(within(machines).getByText(/of 60 h used this month/)).toBeTruthy();
    expect(within(machines).getByText("2.3 h")).toBeTruthy();
    expect(within(machines).getByText("Running")).toBeTruthy();
    expect(within(machines).getByText("Did not start: AWS refused RunTask: AccessDeniedException: not authorized")).toBeTruthy();
    fireEvent.change(within(machines).getByLabelText("Monthly limit in hours"), { target: { value: "0" } });
    fireEvent.click(within(machines).getByRole("button", { name: "Set limit" }));
    expect(await within(machines).findByText(/of 0 h used this month/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/machine-hours-cap",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ hours: 0 }) }),
    );
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
      "GET /api/health": { status: 503, body: { status: "degraded", database: problem, storage: "ok", commit: "development" } },
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

const storageBody = {
  storage: {
    usedBytes: 6_442_450_944,
    freeBytes: 5_368_709_120,
    ratePerGibDay: 10_000,
    retentionDays: 30,
    parts: [
      { kind: "geometry", bytes: 2048, files: 3 },
      { kind: "mesh", bytes: 1_048_576, files: 2 },
      { kind: "results", bytes: 3_145_728, files: 5 },
      { kind: "rawOutput", bytes: 6_438_256_640, files: 2 },
      { kind: "report", bytes: 0, files: 0 },
    ],
    runs: [
      {
        id: "r1",
        simulationId: "s1",
        simulationName: "Static structural",
        startedAt: "2026-10-17T06:00:00.000Z",
        bytes: 6_438_256_640,
        pinned: false,
        keptUntil: "2026-11-16T06:00:05.000Z",
      },
    ],
  },
};

describe("wallet page (M8.1)", () => {
  it("opens from the status bar with the balance and every entry, and closes again", async () => {
    serve({
      "GET /api/health": healthy,
      "GET /api/session": signedIn,
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries": noGeometries,
      "GET /api/storage": { status: 200, body: storageBody },
      "GET /api/wallet": {
        status: 200,
        body: {
          wallet: {
            balance: 99_988_750,
            granted: 100_000_000,
            charged: -11_250,
            entries: [
              {
                seq: 4,
                createdAt: "2026-10-18T03:00:00.000Z",
                reason: "storage",
                amount: -10_000,
                balance: 99_988_750,
                job: null,
                run: null,
                mesh: null,
                storage: { day: "2026-10-18", usedBytes: 6_442_450_944, freeBytes: 5_368_709_120, ratePerGibDay: 10_000 },
              },
              {
                seq: 3,
                createdAt: "2026-10-17T06:00:03.000Z",
                reason: "solve",
                amount: -417,
                balance: 99_998_750,
                job: { id: "j2", machineSize: "small", ratePerHour: 500_000, billedSeconds: 3 },
                run: {
                  id: "r1",
                  simulationId: "s1",
                  simulationName: "Static structural",
                  startedAt: "2026-10-17T06:00:00.000Z",
                  status: "succeeded",
                },
                mesh: null,
                storage: null,
              },
              {
                seq: 2,
                createdAt: "2026-10-17T05:59:00.000Z",
                reason: "mesh",
                amount: -833,
                balance: 99_999_167,
                job: { id: "j1", machineSize: "medium", ratePerHour: 1_000_000, billedSeconds: 3 },
                run: null,
                mesh: { id: "m1", geometryName: "bracket.step", elements: 4000, nodes: 7108 },
                storage: null,
              },
              {
                seq: 1,
                createdAt: "2026-10-17T05:00:00.000Z",
                reason: "grant",
                amount: 100_000_000,
                balance: 100_000_000,
                job: null,
                run: null,
                mesh: null,
                storage: null,
              },
            ],
          },
          selfHosted: false,
        },
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Wallet" }));
    expect((await screen.findByTestId("wallet-balance")).textContent).toBe("99.98875 credits");
    expect(screen.getByText(/A run is refused when its estimate is more than the balance/)).toBeTruthy();
    expect(screen.queryByTestId("wallet-self-hosted")).toBeNull();
    const ledger = within(screen.getByRole("table", { name: "Ledger" }));
    const rows = ledger.getAllByRole("row").slice(1).map((row) => row.textContent);
    expect(rows[0]).toContain("Storage on 2026-10-18: 1 GiB above the 5 GiB free allowance (6 GiB stored)");
    expect(rows[0]).toContain("-0.01 credits");
    expect(rows[1]).toContain("Run of “Static structural”, started 2026-10-17 06:00:00 UTC (solved)");
    expect(rows[1]).toContain("-0.000417 credits");
    expect(rows[2]).toContain("Mesh of bracket.step (4,000 elements)");
    expect(rows[3]).toContain("Credit grant");
    // Storage (M8.6): what is kept by kind, and the runs holding raw output.
    expect((await screen.findByTestId("storage-used")).textContent).toBe("6 GiB");
    expect(screen.getByText(/removed 30 days after its run ends unless the run is pinned/)).toBeTruthy();
    const kinds = within(screen.getByRole("table", { name: "Storage by kind" }))
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
    expect(kinds[0]).toEqual(["Geometry (STEP files, topology, display meshes)", "3", "2 KiB"]);
    expect(kinds[3]).toEqual(["Raw solver output (.frd, .dat)", "2", "6 GiB"]);
    const raw = within(screen.getByRole("table", { name: "Raw solver output" })).getAllByRole("row")[1];
    expect(raw?.textContent).toContain("Until 2026-11-16");
    fireEvent.click(screen.getByRole("button", { name: "Back to the workbench" }));
    expect(screen.queryByRole("region", { name: "Wallet" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Simulation tree" })).toBeTruthy();
  });

  it("says the wallet is information only when self-hosted (M8.10)", async () => {
    serve({
      "GET /api/health": healthy,
      "GET /api/session": signedIn,
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries": noGeometries,
      "GET /api/storage": { status: 200, body: storageBody },
      "GET /api/wallet": {
        status: 200,
        body: { wallet: { balance: -5000, granted: 0, charged: -5000, entries: [] }, selfHosted: true },
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Wallet" }));
    expect((await screen.findByTestId("wallet-balance")).textContent).toBe("-0.005 credits");
    expect(screen.getByTestId("wallet-self-hosted").textContent).toContain("Nothing is refused when the balance runs out");
    expect(screen.queryByText(/A run is refused/)).toBeNull();
  });
});
