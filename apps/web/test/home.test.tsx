// SPDX-License-Identifier: AGPL-3.0-or-later
// The projects home (M14.3): what it shows from the one listing, and the changes made from it.
import type { FolderView, HomeResponse, ProjectView } from "@clearfea/spec";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import {
  contentsOf,
  itemName,
  pathOf,
  projectCount,
  recentOf,
  searchOf,
  sortItems,
  subtreeOf,
  trashOf,
} from "../src/home/tree";

const T0 = "2026-10-14T12:00:00.000Z";
const TRASHED = "2026-10-21T09:00:00.000Z";

function project(id: string, name: string, over: Partial<ProjectView> = {}): ProjectView {
  return {
    id,
    name,
    unitSystem: "metric-mm",
    folderId: null,
    deletedAt: null,
    lastOpenedAt: null,
    thumbnailAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

function folder(id: string, name: string, over: Partial<FolderView> = {}): FolderView {
  return { id, name, parentId: null, deletedAt: null, createdAt: T0, updatedAt: T0, ...over };
}

/**
 * Pumps holds Impellers, which holds a project; Scrap went to the trash with its project; a
 * bracket was trashed on its own from the top.
 */
function sample(): HomeResponse {
  return {
    folders: [
      folder("f-pumps", "Pumps"),
      folder("f-imp", "Impellers", { parentId: "f-pumps" }),
      folder("f-scrap", "Scrap", { deletedAt: TRASHED }),
    ],
    projects: [
      project("p1", "My first project", { lastOpenedAt: "2026-10-20T08:00:00.000Z", thumbnailAt: "2026-10-20T08:01:00.000Z" }),
      project("p2", "Housing", { folderId: "f-pumps", lastOpenedAt: "2026-10-21T08:00:00.000Z", updatedAt: "2026-10-21T08:00:00.000Z" }),
      project("p3", "Blade 10", { folderId: "f-imp" }),
      project("p4", "Blade 9", { folderId: "f-imp" }),
      project("p5", "Old idea", { folderId: "f-scrap", deletedAt: TRASHED }),
      project("p6", "Bracket", { deletedAt: "2026-10-20T09:00:00.000Z" }),
    ],
    trashRetentionDays: 30,
  };
}

describe("what the home shows", () => {
  it("lists a folder's folders and projects outside the trash", () => {
    const home = sample();
    expect(contentsOf(home, null).map(itemName)).toEqual(["Pumps", "My first project"]);
    expect(contentsOf(home, "f-imp").map(itemName)).toEqual(["Blade 10", "Blade 9"]);
    expect(pathOf(home, "f-imp").map((f) => f.name)).toEqual(["Pumps", "Impellers"]);
    expect([...subtreeOf(home, "f-pumps")].sort()).toEqual(["f-imp", "f-pumps"]);
    expect(projectCount(home, "f-pumps")).toBe(3);
  });

  it("puts the projects opened last first in Recent", () => {
    expect(recentOf(sample()).map(itemName)).toEqual(["Housing", "My first project"]);
  });

  it("shows at the top of the trash only what went there on its own", () => {
    expect(trashOf(sample()).map(itemName)).toEqual(["Scrap", "Bracket"]);
  });

  it("searches every folder, ignoring case, and leaves the trash out", () => {
    expect(searchOf(sample(), "bla").map(itemName)).toEqual(["Blade 10", "Blade 9"]);
    expect(searchOf(sample(), "old")).toEqual([]);
    expect(searchOf(sample(), "  ")).toEqual([]);
  });

  it("sorts folders first, then by name with numbers in order, or by time newest first", () => {
    const items = [...contentsOf(sample(), null), ...contentsOf(sample(), "f-imp")];
    expect(sortItems(items, "name").map(itemName)).toEqual(["Pumps", "Blade 9", "Blade 10", "My first project"]);
    expect(sortItems(contentsOf(sample(), "f-pumps"), "modified").map(itemName)).toEqual(["Impellers", "Housing"]);
    expect(sortItems(items, "opened").map(itemName)[1]).toBe("My first project");
  });
});

type Reply = { status: number; body?: unknown };
type Routes = Record<string, Reply | ((init?: RequestInit) => Reply)>;

const alice = { id: "a", login: "alice", name: "Alice (test user)", admin: false };

/** Answers fetch calls by "METHOD /path"; anything not listed is a test error. */
function serve(listed: Routes) {
  const routes: Routes = {
    "GET /api/health": { status: 200, body: { status: "ok", database: "ok", storage: "ok", commit: "development" } },
    "GET /api/session": { status: 200, body: { user: alice } },
    ...listed,
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    const route = routes[key];
    if (route === undefined) throw new Error(`Unexpected request ${key}`);
    const reply = typeof route === "function" ? route(init) : route;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The workbench's own requests for project p, which has no geometry. */
function workbench(p: ProjectView): Routes {
  return {
    [`GET /api/projects/${p.id}`]: { status: 200, body: { project: p } },
    [`POST /api/projects/${p.id}/opened`]: { status: 200, body: { project: p } },
    [`GET /api/geometries?projectId=${p.id}`]: { status: 200, body: { geometries: [] } },
    "GET /api/jobs": { status: 200, body: { jobs: [] } },
  };
}

const main = () => within(screen.getByRole("main"));
const details = () => within(screen.getByRole("complementary", { name: "Details" }));
const sections = () => within(screen.getByRole("navigation", { name: "Home sections" }));
/** The side bar, once the home has loaded. */
const shown = async () => {
  await screen.findByRole("button", { name: /^My first project/ });
  return sections();
};
const sent = (fetchMock: ReturnType<typeof serve>, key: string) =>
  fetchMock.mock.calls.filter(([url, init]) => `${init?.method ?? "GET"} ${String(url)}` === key).map(([, init]) => (init?.body === undefined ? undefined : JSON.parse(String(init.body))));

beforeEach(() => {
  window.history.replaceState(null, "", "/app");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("the projects home", () => {
  it("opens on Recent, with thumbnails, and on My projects with the folder tree", async () => {
    serve({ "GET /api/projects": { status: 200, body: sample() } });
    render(<App />);
    const recent = await screen.findByRole("list", { name: "Recent, as a grid" });
    expect(within(recent).getAllByRole("button").map((b) => b.querySelector(".home-card-name")?.textContent)).toEqual([
      "Housing",
      "My first project",
    ]);
    const picture = recent.querySelector("img");
    expect(picture?.getAttribute("src")).toBe("/api/projects/p1/thumbnail?at=2026-10-20T08%3A01%3A00.000Z");

    fireEvent.click(sections().getByRole("button", { name: "My projects" }));
    expect(main().getByRole("heading", { name: "My projects" })).toBeTruthy();
    expect(main().getByText("3 projects")).toBeTruthy();
    fireEvent.click(sections().getByRole("button", { name: "Impellers" }));
    expect(main().getByRole("navigation", { name: "Folder path" }).textContent).toBe("My projectsPumpsImpellers");
    expect(main().getByText("Blade 9")).toBeTruthy();
  });

  it("shows a project's details, and opens it in the workbench", async () => {
    const home = sample();
    const housing = home.projects[1] as ProjectView;
    serve({ "GET /api/projects": { status: 200, body: home }, ...workbench(housing) });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /^Housing/ }));
    expect(details().getByText("Location").nextElementSibling?.textContent).toBe("Pumps");
    expect(details().getByText("Metric (mm, N, MPa)")).toBeTruthy();
    fireEvent.click(details().getByRole("button", { name: "Open project" }));
    expect(await screen.findByRole("navigation", { name: "Simulation tree" })).toBeTruthy();
    expect(window.location.pathname).toBe("/app/p/p2");
    expect(within(screen.getByRole("banner")).getByText("Housing")).toBeTruthy();

    // The header's Projects goes back home.
    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "Projects" }));
    expect(await screen.findByRole("navigation", { name: "Home sections" })).toBeTruthy();
    expect(window.location.pathname).toBe("/app");
  });

  it("makes a project in the folder on show and opens it", async () => {
    const made = project("p9", "Valve body", { folderId: "f-pumps" });
    const fetchMock = serve({
      "GET /api/projects": { status: 200, body: sample() },
      "POST /api/projects": { status: 201, body: { project: made } },
      ...workbench(made),
    });
    render(<App />);
    fireEvent.click((await shown()).getByRole("button", { name: "Pumps" }));
    fireEvent.click(main().getByRole("button", { name: "New project" }));
    fireEvent.change(main().getByLabelText("Project name"), { target: { value: "Valve body" } });
    fireEvent.click(main().getByRole("button", { name: "Create and open" }));
    expect(await screen.findByRole("navigation", { name: "Simulation tree" })).toBeTruthy();
    expect(window.location.pathname).toBe("/app/p/p9");
    expect(sent(fetchMock, "POST /api/projects")).toEqual([{ name: "Valve body", folderId: "f-pumps" }]);
  });

  it("renames, moves and trashes a project, reading the home again after each", async () => {
    const fetchMock = serve({
      "GET /api/projects": { status: 200, body: sample() },
      "PATCH /api/projects/p1": { status: 200, body: { project: project("p1", "Bracket A") } },
      "POST /api/projects/p1/trash": { status: 200, body: { project: project("p1", "Bracket A", { deletedAt: TRASHED }) } },
    });
    render(<App />);
    fireEvent.click((await shown()).getByRole("button", { name: "My projects" }));
    fireEvent.click(main().getByRole("button", { name: /^My first project/ }));
    fireEvent.click(details().getByRole("button", { name: "Rename" }));
    fireEvent.change(details().getByLabelText("Name"), { target: { value: "Bracket A" } });
    fireEvent.click(details().getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(sent(fetchMock, "PATCH /api/projects/p1")).toEqual([{ name: "Bracket A" }]));

    fireEvent.change(details().getByLabelText("Move to"), { target: { value: "f-imp" } });
    fireEvent.click(details().getByRole("button", { name: "Move" }));
    await waitFor(() => expect(sent(fetchMock, "PATCH /api/projects/p1").at(-1)).toEqual({ folderId: "f-imp" }));

    fireEvent.click(details().getByRole("button", { name: "Move to trash" }));
    await waitFor(() => expect(sent(fetchMock, "POST /api/projects/p1/trash")).toHaveLength(1));
    expect(sent(fetchMock, "GET /api/projects").length).toBeGreaterThanOrEqual(4);
  });

  it("offers a folder's own folders out of its moves", async () => {
    serve({ "GET /api/projects": { status: 200, body: sample() } });
    render(<App />);
    fireEvent.click((await shown()).getByRole("button", { name: "My projects" }));
    fireEvent.click(main().getByRole("button", { name: /^Pumps/ }));
    const options = within(details().getByLabelText("Move to")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["My projects (top)"]);
  });

  it("lists the trash with when each item goes for good, and restores one", async () => {
    const fetchMock = serve({
      "GET /api/projects": { status: 200, body: sample() },
      "POST /api/folders/f-scrap/restore": { status: 200, body: { folder: folder("f-scrap", "Scrap") } },
    });
    render(<App />);
    fireEvent.click((await shown()).getByRole("button", { name: "Trash" }));
    expect(main().getByText(/removed for good 30 days after/)).toBeTruthy();
    const cards = main().getAllByRole("button").filter((b) => b.classList.contains("home-card"));
    expect(cards.map((b) => b.querySelector(".home-card-name")?.textContent)).toEqual(["Scrap", "Bracket"]);
    fireEvent.click(main().getByRole("button", { name: /^Scrap/ }));
    expect(details().getByText("1 project")).toBeTruthy();
    expect(details().queryByRole("button", { name: "Open folder" })).toBeNull();
    fireEvent.click(details().getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(sent(fetchMock, "POST /api/folders/f-scrap/restore")).toHaveLength(1));
  });

  it("searches by name and shows the matches as a list with their folders", async () => {
    serve({ "GET /api/projects": { status: 200, body: sample() } });
    render(<App />);
    await shown();
    fireEvent.change(screen.getByLabelText("Search projects and folders"), { target: { value: "blade" } });
    fireEvent.click(main().getByRole("button", { name: "List" }));
    const rows = within(main().getByRole("table", { name: "Search, as a list" })).getAllByRole("row").slice(1) as HTMLTableRowElement[];
    expect(rows.map((r) => [r.cells[0]?.textContent, r.cells[1]?.textContent])).toEqual([
      ["Blade 9", "Pumps / Impellers"],
      ["Blade 10", "Pumps / Impellers"],
    ]);
  });

  it("says when a project cannot be opened because it is in the trash", async () => {
    window.history.replaceState(null, "", "/app/p/p6");
    const bracket = sample().projects[5] as ProjectView;
    serve({ ...workbench(bracket) });
    render(<App />);
    expect((await screen.findByRole("alert")).textContent).toContain("Bracket is in the trash");
  });
});
