// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

type Reply = { status: number; body?: unknown } | Error;
type Routes = Record<string, Reply | (() => Reply)>;

const healthy = { status: 200, body: { status: "ok", database: "ok", storage: "ok", commit: "development" } };
const alice = { id: "a", login: "alice", name: "Alice (test user)", admin: false };
const signedIn = { status: 200, body: { user: alice } };
const signedOut = { status: 401, body: { error: "You are not signed in." } };
const noGeometries = { status: 200, body: { geometries: [] } };
// The workbench opens a project, /app/p/p1 (M14.3); the home page has tests of its own.
const project = {
  id: "p1",
  name: "My first project",
  unitSystem: "metric-mm",
  folderId: null,
  deletedAt: null,
  lastOpenedAt: null,
  thumbnailAt: null,
  createdAt: "2026-10-14T12:00:00.000Z",
  updatedAt: "2026-10-14T12:00:00.000Z",
};

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
  const routes: Routes = {
    "GET /api/session/options": { status: 200, body: { signIn: "password" } },
    "GET /api/projects/p1": { status: 200, body: { project } },
    "POST /api/projects/p1/opened": { status: 200, body: { project } },
    ...listed,
  };
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

beforeEach(() => {
  window.history.replaceState(null, "", "/app/p/p1");
});

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
      "GET /api/geometries?projectId=p1": noGeometries,
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
      "GET /api/geometries?projectId=p1": noGeometries,
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

  it("says what to try when the server refuses to start Google sign-in", async () => {
    serve({
      "GET /api/health": healthy,
      "GET /api/session": signedOut,
      "GET /api/session/options": google,
      "POST /api/auth/sign-in/social": { status: 403, body: { message: "Missing or null Origin", code: "MISSING_OR_NULL_ORIGIN" } },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));
    const alert = (await screen.findByRole("alert")).textContent ?? "";
    expect(alert).toContain("Your browser did not say that this sign-in came from");
    expect(alert).toContain("MISSING_OR_NULL_ORIGIN");
    expect(alert).not.toContain("did not answer");
  });

  it("shows what else refused the start of Google sign-in", async () => {
    serve({
      "GET /api/health": healthy,
      "GET /api/session": signedOut,
      "GET /api/session/options": google,
      "POST /api/auth/sign-in/social": { status: 403, body: "error code: 1010" },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));
    const alert = (await screen.findByRole("alert")).textContent ?? "";
    expect(alert).toContain("HTTP 403 (error code: 1010)");
    expect(alert).not.toContain("did not say");
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

/** The dashboard's Overview (M13.2): nothing running, nothing waiting. */
function overview(paused = false, alerts: unknown[] = []) {
  return {
    status: 200,
    body: {
      machines: "local",
      paused,
      pausedAt: paused ? "2026-10-22T18:00:00.000Z" : null,
      host: null,
      load: null,
      lanes: [
        { lane: "solve", running: [], queued: [] },
        { lane: "light", running: [], queued: [] },
      ],
      alerts,
    },
  };
}

/** The Settings tab's answer: the free storage and the monthly hours cap (M13.3). */
function settings(hoursCap: number) {
  return {
    status: 200,
    body: {
      settings: [
        {
          name: "storage_free_bytes",
          group: "storage",
          label: "Free storage per user",
          description: "Stored files above this are charged once a day.",
          unit: "GiB",
          scale: 2 ** 30,
          min: 0,
          max: 1024 * 2 ** 30,
          value: 5 * 2 ** 30,
        },
        {
          name: "machine_hours_cap",
          group: "machines",
          label: "Monthly limit of machine hours",
          description: "Cloud machines only.",
          unit: "h",
          scale: 1,
          min: 0,
          max: 744,
          value: hoursCap,
        },
      ],
    },
  };
}

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
          jobsThisMonth: 7,
          failedJobsThisMonth: 2,
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
      solverHost: null,
    },
  });

  it("is offered to the admin only", async () => {
    serve({
      "GET /api/health": healthy,
      "GET /api/session": signedIn,
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries?projectId=p1": noGeometries,
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
      "GET /api/geometries?projectId=p1": noGeometries,
      "GET /api/admin": view([]),
      "GET /api/admin/overview": overview(),
      "POST /api/admin/allowed": view(["colleague@gmail.com"]),
      "DELETE /api/admin/allowed/colleague%40gmail.com": view([]),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Admin" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Users" }));
    const page = await screen.findByRole("region", { name: "Admin" });
    expect(await within(page).findByText("Nobody else is invited yet.")).toBeTruthy();
    expect(within(page).getByText("1 h 05 min")).toBeTruthy();
    const users = within(page).getByRole("table", { name: "Users" });
    expect(within(users).getByText("7")).toBeTruthy();
    expect(within(users).getByText("2")).toBeTruthy();
    fireEvent.change(within(page).getByLabelText("Email address"), { target: { value: "colleague@gmail.com" } });
    fireEvent.click(within(page).getByRole("button", { name: "Add" }));
    expect(await within(page).findByText("colleague@gmail.com")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/allowed",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "colleague@gmail.com" }) }),
    );
    fireEvent.click(within(page).getByRole("button", { name: "Remove colleague@gmail.com" }));
    expect(await within(page).findByText("Nobody else is invited yet.")).toBeTruthy();
    fireEvent.click(within(page).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Admin" })).toBeNull();
  });

  it("switches the large machine size on, and keeps the default size on (M10.6)", async () => {
    const fetchMock = serve({
      "GET /api/health": healthy,
      "GET /api/session": admin,
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries?projectId=p1": noGeometries,
      "GET /api/admin": view([]),
      "GET /api/admin/overview": overview(),
      "GET /api/admin/settings": settings(60),
      "PUT /api/admin/machine-sizes/large": view([], true),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Admin" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
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

  it("shows the solver machines and sets the monthly hours limit under Settings (M10.7, M13.3)", async () => {
    let cap = 60;
    const fetchMock = serve({
      "GET /api/health": healthy,
      "GET /api/session": admin,
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries": noGeometries,
      "GET /api/admin": () => view([], false, cap),
      "GET /api/admin/overview": overview(),
      "GET /api/admin/settings": () => settings(cap),
      "PUT /api/admin/settings/machine_hours_cap": () => {
        cap = 0;
        return settings(cap);
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Admin" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    const machines = await screen.findByRole("region", { name: "Solver machines" });
    expect(within(machines).getByText(/of 60 h used this month/)).toBeTruthy();
    expect(within(machines).getByText("2.3 h")).toBeTruthy();
    expect(within(machines).getByText("Running")).toBeTruthy();
    expect(within(machines).getByText("Did not start: AWS refused RunTask: AccessDeniedException: not authorized")).toBeTruthy();
    const cloud = await screen.findByRole("region", { name: "Cloud machines" });
    const field = within(cloud).getByLabelText("Monthly limit of machine hours") as HTMLInputElement;
    expect(field.value).toBe("60");
    fireEvent.change(field, { target: { value: "0" } });
    fireEvent.click(within(cloud).getByRole("button", { name: "Save Monthly limit of machine hours" }));
    expect(await within(machines).findByText(/of 0 h used this month/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/settings/machine_hours_cap",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ value: 0 }) }),
    );
  });

  it("shows a setting in its unit and saves it in stored units, or says why it was refused (M13.3)", async () => {
    const fetchMock = serve({
      "GET /api/health": healthy,
      "GET /api/session": admin,
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries?projectId=p1": noGeometries,
      "GET /api/admin": view([]),
      "GET /api/admin/overview": overview(),
      "GET /api/admin/settings": settings(60),
      "PUT /api/admin/settings/storage_free_bytes": {
        status: 400,
        body: { error: 'Give "Free storage per user" a value from 0 GiB to 1024 GiB. Nothing was changed.' },
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Admin" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    const storage = await screen.findByRole("region", { name: "Storage" });
    const field = within(storage).getByLabelText("Free storage per user") as HTMLInputElement;
    expect(field.value).toBe("5");
    expect(within(storage).getByText("GiB")).toBeTruthy();
    fireEvent.change(field, { target: { value: "2000.5" } });
    fireEvent.click(within(storage).getByRole("button", { name: "Save Free storage per user" }));
    expect((await within(storage).findByRole("alert")).textContent).toContain("from 0 GiB to 1024 GiB");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/settings/storage_free_bytes",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ value: 2000.5 * 2 ** 30 }) }),
    );
  });
});

describe("admin Costs tab (M13.3)", () => {
  it("shows the month's use beside the fixed costs, per hour and per run", async () => {
    serve({
      "GET /api/health": healthy,
      "GET /api/session": { status: 200, body: { user: { ...alice, admin: true } } },
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries": noGeometries,
      "GET /api/admin/overview": overview(),
      [`GET /api/admin/costs?month=${new Date().toISOString().slice(0, 7)}`]: {
        status: 200,
        body: {
          month: "2026-10",
          solverHostCents: 1700,
          platformCents: 500,
          totals: { jobs: 12, solveRuns: 4, machineSeconds: 7200, jobMicroCredits: 1_500_000, storageMicroCredits: 20_000 },
          byUser: [
            {
              userId: "b",
              name: "Bob (test user)",
              email: "bob@clearfea.test",
              jobs: 12,
              solveRuns: 4,
              machineSeconds: 7200,
              jobMicroCredits: 1_500_000,
              storageMicroCredits: 20_000,
            },
          ],
          byType: [{ type: "solve", jobs: 4, machineSeconds: 6000, jobMicroCredits: 1_250_000 }],
        },
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Admin" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Costs" }));
    const page = await screen.findByRole("region", { name: "Admin" });
    expect((await within(page).findByTestId("costs-fixed")).textContent).toBe("$22.00 a month");
    expect(within(page).getByText("$11.00")).toBeTruthy(); // per machine hour: $22 over 2 h
    expect(within(page).getByText("$5.50")).toBeTruthy(); // per run: $22 over 4 runs
    const byUser = within(page).getByRole("table", { name: "Costs by user" });
    expect(within(byUser).getByText("bob@clearfea.test")).toBeTruthy();
    expect(within(byUser).getByText("100 %")).toBeTruthy();
    expect(within(page).getByRole("table", { name: "Costs by job type" }).textContent).toContain("1.25 credits");
  });
});

describe("admin page on the solver host (M12.4)", () => {
  const admin = { status: 200, body: { user: { ...alice, admin: true } } };
  const view = (online: boolean | null) => ({
    status: 200,
    body: {
      adminEmail: "alice@clearfea.test",
      allowed: [],
      users: [],
      machines: "vps",
      cloudSizes: [{ name: "medium", cores: 4, memoryBytes: 17179869184, enabled: true, default: true }],
      solverMachines: { launcher: "local", problem: null, hoursThisMonth: 0, hoursCap: 60, starts: [] },
      solverHost:
        online === null
          ? null
          : {
              host: "vps-1",
              online,
              lastSeenAt: "2026-10-22T16:00:30.000Z",
              firstSeenAt: "2026-10-22T08:00:00.000Z",
              managerVersion: "0.1.0",
            },
    },
  });

  for (const [online, text] of [
    [true, "vps-1 is online: last check-in 2026-10-22 16:00 UTC, up since 2026-10-22 08:00 UTC, manager 0.1.0."],
    [false, "vps-1 is offline: no check-in since 2026-10-22 16:00 UTC"],
    [null, "No solver host has checked in yet"],
  ] as const) {
    it(`shows the host ${online === null ? "never seen" : online ? "online" : "offline"} instead of the AWS machines`, async () => {
      serve({
        "GET /api/health": healthy,
        "GET /api/session": admin,
        "GET /api/jobs": { status: 200, body: { jobs: [] } },
        "GET /api/geometries?projectId=p1": noGeometries,
        "GET /api/admin": view(online),
        "GET /api/admin/overview": overview(),
        "GET /api/admin/settings": { status: 200, body: { settings: [] } },
      });
      render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: "Admin" }));
      fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
      const card = await screen.findByRole("region", { name: "Solver host" });
      expect(card.textContent).toContain(text);
      expect(screen.queryByRole("region", { name: "Solver machines" })).toBeNull();
    });
  }
});

describe("admin dashboard (M13.2)", () => {
  const admin = { status: 200, body: { user: { ...alice, admin: true } } };
  const base = {
    "GET /api/health": healthy,
    "GET /api/session": admin,
    "GET /api/jobs": { status: 200, body: { jobs: [] } },
    "GET /api/geometries": noGeometries,
    "GET /api/admin": {
      status: 200,
      body: {
        adminEmail: "alice@clearfea.test",
        allowed: [],
        users: [
          {
            id: "b",
            name: "Bob (test user)",
            email: "bob@clearfea.test",
            createdAt: "2026-10-19T05:00:00.000Z",
            lastSignIn: null,
            machineSecondsThisMonth: 0,
            jobsThisMonth: 0,
            failedJobsThisMonth: 0,
            allowed: true,
          },
        ],
        machines: "vps",
        cloudSizes: [],
        solverMachines: { launcher: "ready", problem: null, hoursThisMonth: 0, hoursCap: 0, starts: [] },
        solverHost: null,
      },
    },
  };
  const adminJob = (status: string) => ({
    id: "11111111-2222-4333-8444-555555555555",
    type: "solve",
    lane: "solve",
    status,
    stage: status === "running" ? "solving" : null,
    ownerId: "b",
    ownerEmail: "bob@clearfea.test",
    targetId: "run-1",
    attempt: 1,
    machineSize: "medium",
    claimedBy: status === "queued" ? null : "vps-1-solve",
    stopRequested: null,
    createdAt: "2026-10-22T18:00:00.000Z",
    claimedAt: status === "queued" ? null : "2026-10-22T18:00:05.000Z",
    heartbeatAt: null,
    finishedAt: status === "failed" ? "2026-10-22T18:01:00.000Z" : null,
    failureCategory: status === "failed" ? "platform_fault" : null,
    failureCause: status === "failed" ? "cancelled_by_admin" : null,
    failureMessage: status === "failed" ? "The run was stopped by the ClearFEA administrator (cancelled_by_admin)." : null,
    peakMemoryBytes: null,
    billedSeconds: null,
    queuePosition: null,
  });

  it("shows the alerts and lanes, and pauses the queue", async () => {
    const running = overview(false);
    running.body.lanes[0] = { lane: "solve", running: [adminJob("running")] as never[], queued: [] };
    const fetchMock = serve({
      ...base,
      "GET /api/admin/overview": running,
      "PUT /api/admin/queue-paused": overview(true, [
        { kind: "queue_paused", level: "warning", message: "The queue is paused, so no job starts; 0 jobs wait." },
      ]),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Admin" }));
    const lane = await screen.findByRole("region", { name: "Solve lane" });
    expect(await within(lane).findByText("Running: solving")).toBeTruthy();
    expect(within(lane).getByText("bob@clearfea.test")).toBeTruthy();
    expect(within(lane).getByText("vps-1-solve")).toBeTruthy();
    const queue = screen.getByRole("region", { name: "Queue" });
    fireEvent.click(within(queue).getByRole("button", { name: "Pause the queue" }));
    expect(await within(queue).findByRole("button", { name: "Resume the queue" })).toBeTruthy();
    expect(within(queue).getByTestId("queue-state").textContent).toContain("Paused since 2026-10-22 18:00 UTC");
    const alerts = within(screen.getByRole("list", { name: "Alerts" })).getAllByRole("alert");
    expect(alerts.map((a) => a.textContent)).toEqual(["The queue is paused, so no job starts; 0 jobs wait."]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/queue-paused",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ paused: true }) }),
    );
  });

  it("lists jobs, shows one's tries and log, and cancels it after asking", async () => {
    const fetchMock = serve({
      ...base,
      "GET /api/admin/overview": overview(),
      "GET /api/admin/jobs?limit=50": { status: 200, body: { jobs: [adminJob("running")] } },
      "GET /api/admin/stats/jobs?job=11111111-2222-4333-8444-555555555555": { status: 200, body: { tries: [] } },
      "GET /api/admin/jobs/11111111-2222-4333-8444-555555555555/log?after=0": {
        status: 200,
        body: { text: "CalculiX started\n", next: 1, more: false },
      },
      "POST /api/admin/jobs/11111111-2222-4333-8444-555555555555/cancel": {
        status: 200,
        body: { job: adminJob("failed") },
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Admin" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Jobs and runs" }));
    fireEvent.click(await screen.findByRole("button", { name: "Details of job 11111111-2222-4333-8444-555555555555" }));
    const details = await screen.findByRole("region", { name: "Job details" });
    expect((await within(details).findByRole("log", { name: "Job log" })).textContent).toBe("CalculiX started\n");
    expect(within(details).getByText("No worker has taken it yet.")).toBeTruthy();
    fireEvent.click(within(details).getByRole("button", { name: "Cancel job" }));
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/cancel"), expect.anything());
    fireEvent.click(within(details).getByRole("button", { name: "Yes, cancel it" }));
    await waitFor(() => expect(within(details).getByTestId("job-status").textContent).toBe("Failed"));
    expect(within(details).getByText(/The user was told: The run was stopped by the ClearFEA administrator/)).toBeTruthy();
    expect(within(details).queryByRole("button", { name: "Cancel job" })).toBeNull();
  });

  it("filters the jobs by user and by days in UTC", async () => {
    const fetchMock = serve({
      ...base,
      "GET /api/admin/overview": overview(),
      "GET /api/admin/jobs?limit=50": { status: 200, body: { jobs: [adminJob("running")] } },
      "GET /api/admin/jobs?user=b&limit=50": { status: 200, body: { jobs: [adminJob("running")] } },
      "GET /api/admin/jobs?user=b&since=2026-10-21T00%3A00%3A00.000Z&limit=50": { status: 200, body: { jobs: [] } },
      "GET /api/admin/jobs?user=b&since=2026-10-21T00%3A00%3A00.000Z&before=2026-10-23T00%3A00%3A00.000Z&limit=50": {
        status: 200,
        body: { jobs: [adminJob("running")] },
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Admin" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Jobs and runs" }));
    await screen.findByRole("table", { name: "Jobs" });
    const user = screen.getByLabelText("User");
    await within(user).findByRole("option", { name: "bob@clearfea.test" });
    fireEvent.change(user, { target: { value: "b" } });
    fireEvent.change(screen.getByLabelText("From (UTC)"), { target: { value: "2026-10-21" } });
    expect(await screen.findByText("No jobs match.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("To (UTC)"), { target: { value: "2026-10-22" } });
    expect(await screen.findByRole("table", { name: "Jobs" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/jobs?user=b&since=2026-10-21T00%3A00%3A00.000Z&before=2026-10-23T00%3A00%3A00.000Z&limit=50",
      expect.anything(),
    );
  });

  it("reads the event log and filters it by kind", async () => {
    const event = (id: number, kind: string, message: string) => ({
      id,
      at: "2026-10-22T18:00:00.000Z",
      kind,
      level: kind === "host_offline" ? "error" : "info",
      userId: null,
      jobId: null,
      host: null,
      message,
      detail: null,
    });
    serve({
      ...base,
      "GET /api/admin/overview": overview(),
      "GET /api/admin/events?limit=100": {
        status: 200,
        body: { events: [event(2, "host_offline", "The solver host vps-1 has not checked in."), event(1, "admin_action", "Resumed the queue.")] },
      },
      "GET /api/admin/events?kind=admin_action&limit=100": {
        status: 200,
        body: { events: [event(1, "admin_action", "Resumed the queue.")] },
      },
      "GET /api/admin/events?kind=admin_action&before=2026-10-22T00%3A00%3A00.000Z&limit=100": {
        status: 200,
        body: { events: [] },
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Admin" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Events" }));
    const table = await screen.findByRole("table", { name: "Events" });
    expect(within(table).getByText("The solver host vps-1 has not checked in.")).toBeTruthy();
    expect(within(table).getByText("Host offline")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "admin_action" } });
    await waitFor(() => expect(screen.queryByText("The solver host vps-1 has not checked in.")).toBeNull());
    expect(screen.getByText("Resumed the queue.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("To (UTC)"), { target: { value: "2026-10-21" } });
    await waitFor(() => expect(screen.queryByText("Resumed the queue.")).toBeNull());
    expect(screen.getByText("No events match.")).toBeTruthy();
  });
});

describe("layout shell", () => {
  it("shows the tree, viewer, settings panel and status bar", async () => {
    serve({
      "GET /api/health": healthy,
      "GET /api/session": signedIn,
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries?projectId=p1": noGeometries,
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
      "GET /api/geometries?projectId=p1": noGeometries,
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
      "GET /api/geometries?projectId=p1": noGeometries,
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
      "GET /api/geometries?projectId=p1": noGeometries,
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
          usageOnly: false,
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
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Wallet" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Simulation tree" })).toBeTruthy();
  });

  it("says the wallet is information only when self-hosted (M8.10)", async () => {
    serve({
      "GET /api/health": healthy,
      "GET /api/session": signedIn,
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries?projectId=p1": noGeometries,
      "GET /api/storage": { status: 200, body: storageBody },
      "GET /api/wallet": {
        status: 200,
        body: { wallet: { balance: -5000, granted: 0, charged: -5000, entries: [] }, selfHosted: true, usageOnly: false },
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Wallet" }));
    expect((await screen.findByTestId("wallet-balance")).textContent).toBe("-0.005 credits");
    expect(screen.getByTestId("wallet-self-hosted").textContent).toContain("Nothing is refused when the balance runs out");
    expect(screen.queryByText(/A run is refused/)).toBeNull();
  });

  it("shows usage only, without a balance or grants, on the solver host (M12.4, ADR-106 item 6)", async () => {
    serve({
      "GET /api/health": healthy,
      "GET /api/session": signedIn,
      "GET /api/jobs": { status: 200, body: { jobs: [] } },
      "GET /api/geometries?projectId=p1": noGeometries,
      "GET /api/storage": { status: 200, body: storageBody },
      "GET /api/wallet": {
        status: 200,
        body: {
          wallet: {
            balance: 99_999_167,
            granted: 100_000_000,
            charged: -833,
            entries: [
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
          usageOnly: true,
        },
      },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Wallet" }));
    expect((await screen.findByTestId("wallet-used")).textContent).toBe("0.000833 credits");
    expect(screen.queryByTestId("wallet-balance")).toBeNull();
    expect(screen.getByTestId("wallet-usage-only").textContent).toContain("nothing is refused for it");
    expect(screen.queryByText(/Credit grant/)).toBeNull();
    const usage = within(screen.getByRole("table", { name: "Usage" }));
    const rows = usage.getAllByRole("row").slice(1).map((row) => row.textContent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Mesh of bracket.step (4,000 elements)");
    expect(rows[0]).toContain("3 s");
    expect(screen.queryByRole("table", { name: "Ledger" })).toBeNull();
  });
});
