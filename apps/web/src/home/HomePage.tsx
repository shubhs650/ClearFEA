// SPDX-License-Identifier: AGPL-3.0-or-later
// The projects home at /app (M14.3, ADR-114, ADR-124): Recent, My projects with the folder tree,
// and the Trash; folders and projects as a grid of thumbnails or a list, sorted and searched;
// an info panel for the chosen item with its actions. Every change goes to the API and the home
// is read again from its one listing.

import type { FolderView, HomeResponse, ProjectView, SessionUser } from "@clearfea/spec";
import { unitsTable } from "@clearfea/spec";
import {
  Box,
  ChevronRight,
  Clock,
  Copy,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  List,
  Moon,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Sun,
  Trash2,
} from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  changeFolder,
  changeProject,
  createFolder,
  createProject,
  fetchHome,
  folderAction,
  projectAction,
  thumbnailUrl,
} from "../api/projects";
import type { ApiResult } from "../api/request";
import { Logo } from "../layout/AppHeader";
import type { Theme } from "../layout/theme";
import {
  contentsOf,
  type Item,
  itemId,
  itemName,
  liveFolders,
  pathOf,
  projectCount,
  purgeDate,
  recentOf,
  SORTS,
  type Sort,
  searchOf,
  sortItems,
  subtreeOf,
  trashedProjectCount,
  trashOf,
} from "./tree";
import "./home.css";

type Section = { kind: "recent" } | { kind: "folder"; id: string | null } | { kind: "trash" };
type Layout = "grid" | "list";
type Loaded = { kind: "loading" } | { kind: "ok"; home: HomeResponse } | { kind: "error"; problem: string };

const TOP = "";

/** A date and time in the browser's own way of writing them. */
function when(iso: string | null): string {
  if (iso === null) return "Never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function day(date: Date): string {
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function unitSystemName(id: string): string {
  return unitsTable.systems[id]?.name ?? id;
}

export function HomePage({
  user,
  theme,
  onTheme,
  onOpenProject,
  onSignedOut,
  statusBar,
  overlays,
}: {
  user: SessionUser;
  theme: Theme;
  onTheme: (next: Theme) => void;
  onOpenProject: (id: string) => void;
  onSignedOut: (problem: string) => void;
  statusBar: ReactNode;
  /** The wallet or admin page, drawn over the home. */
  overlays: ReactNode;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [section, setSection] = useState<Section | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("opened");
  const [layout, setLayout] = useState<Layout>("grid");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState<"project" | "folder" | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  /** The value of an API answer, or undefined with its problem shown. */
  const handle = useCallback(
    <T,>(result: ApiResult<T>): T | undefined => {
      if (result.kind === "ok") {
        setProblem(undefined);
        return result.value;
      }
      if (result.kind === "signedOut") onSignedOut(result.problem);
      else setProblem(result.problem);
      return undefined;
    },
    [onSignedOut],
  );

  const reload = useCallback(async () => {
    const result = await fetchHome();
    if (result.kind === "ok") setLoaded({ kind: "ok", home: result.value });
    else if (result.kind === "signedOut") onSignedOut(result.problem);
    else setLoaded((was) => (was.kind === "ok" ? was : { kind: "error", problem: result.problem }));
    if (result.kind === "error") setProblem(result.problem);
    return result;
  }, [onSignedOut]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const home = loaded.kind === "ok" ? loaded.home : null;
  // Recent first once the user has opened a project, else the top of My projects.
  const shown: Section = section ?? (home !== null && recentOf(home).length > 0 ? { kind: "recent" } : { kind: "folder", id: null });
  const searching = query.trim() !== "" && shown.kind !== "trash";

  const items = useMemo(() => {
    if (home === null) return [];
    if (shown.kind === "trash") return sortItems(trashOf(home), sort === "opened" ? "modified" : sort);
    if (searching) return sortItems(searchOf(home, query), sort);
    if (shown.kind === "recent") return recentOf(home);
    return sortItems(contentsOf(home, shown.id), sort);
  }, [home, shown, searching, query, sort]);

  const selected = items.find((item) => itemId(item) === selectedId) ?? null;

  function go(next: Section) {
    setSection(next);
    setSelectedId(null);
    setCreating(null);
    setQuery("");
  }

  /** Opens a project in the workbench, or a folder in the home. */
  function open(item: Item) {
    if (shown.kind === "trash") return;
    if (item.kind === "project") onOpenProject(item.project.id);
    else go({ kind: "folder", id: item.folder.id });
  }

  // New items go into the folder on show, or at the top from Recent and a search.
  const target = shown.kind === "folder" && !searching ? shown.id : null;

  async function create(event: FormEvent) {
    event.preventDefault();
    if (creating === null) return;
    setBusy(true);
    if (creating === "project") {
      const project = handle(await createProject(newName, target));
      setBusy(false);
      if (project) onOpenProject(project.id);
      return;
    }
    const folder = handle(await createFolder(newName, target));
    if (folder) {
      setCreating(null);
      setNewName("");
      await reload();
      setSelectedId(folder.id);
    }
    setBusy(false);
  }

  /** Runs a change, then reads the home again; true when the change was made. */
  async function act(
    change: () => Promise<ApiResult<ProjectView | FolderView>>,
    after?: (value: ProjectView | FolderView) => void,
  ): Promise<boolean> {
    setBusy(true);
    const value = handle(await change());
    if (value !== undefined) {
      await reload();
      after?.(value);
    }
    setBusy(false);
    return value !== undefined;
  }

  const title = searching ? "Search" : shown.kind === "recent" ? "Recent" : shown.kind === "trash" ? "Trash" : "My projects";

  return (
    <div className="home-shell">
      <header className="app-header">
        <div className="app-brand">
          <Logo />
          <span className="app-name">
            Clear<strong>FEA</strong>
          </span>
        </div>
        <div className="app-document">
          <span className="app-file">Projects of {user.name}</span>
        </div>
        <div className="app-header-tools">
          <button
            type="button"
            className="header-icon"
            title={theme === "dark" ? "Use the light theme" : "Use the dark theme"}
            aria-label={theme === "dark" ? "Light theme" : "Dark theme"}
            onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <nav className="pane home-nav" aria-label="Home sections">
        <button
          type="button"
          className="home-nav-item"
          aria-current={shown.kind === "recent" ? "page" : undefined}
          onClick={() => go({ kind: "recent" })}
        >
          <Clock size={16} aria-hidden="true" />
          Recent
        </button>
        <button
          type="button"
          className="home-nav-item"
          aria-current={shown.kind === "folder" && shown.id === null ? "page" : undefined}
          onClick={() => go({ kind: "folder", id: null })}
        >
          <Box size={16} aria-hidden="true" />
          My projects
        </button>
        {home !== null && <FolderTree home={home} parentId={null} depth={1} shown={shown} onGo={go} />}
        <button
          type="button"
          className="home-nav-item"
          aria-current={shown.kind === "trash" ? "page" : undefined}
          onClick={() => go({ kind: "trash" })}
        >
          <Trash2 size={16} aria-hidden="true" />
          Trash
        </button>
      </nav>

      <main className="home-main" aria-label={title}>
        <div className="home-toolbar">
          <div className="home-heading">
            {shown.kind === "folder" && !searching && home !== null ? (
              <Breadcrumb home={home} folderId={shown.id} onGo={go} />
            ) : (
              <h1>{title}</h1>
            )}
          </div>
          {shown.kind !== "trash" && (
            <label className="home-search">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search projects and folders"
                aria-label="Search projects and folders"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedId(null);
                }}
              />
            </label>
          )}
          <label className="ribbon-field home-sort">
            <span>Sort by</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as Sort)} disabled={shown.kind === "recent" && !searching}>
              {(Object.keys(SORTS) as Sort[])
                .filter((s) => shown.kind !== "trash" || s !== "opened")
                .map((s) => (
                  <option key={s} value={s}>
                    {SORTS[s]}
                  </option>
                ))}
            </select>
          </label>
          <div className="home-layout">
            <button type="button" className="header-icon" aria-pressed={layout === "grid"} aria-label="Grid" title="Show as a grid" onClick={() => setLayout("grid")}>
              <LayoutGrid size={16} aria-hidden="true" />
            </button>
            <button type="button" className="header-icon" aria-pressed={layout === "list"} aria-label="List" title="Show as a list" onClick={() => setLayout("list")}>
              <List size={16} aria-hidden="true" />
            </button>
          </div>
          {shown.kind !== "trash" && (
            <div className="home-new">
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setCreating("folder");
                  setNewName("New folder");
                }}
              >
                <FolderPlus size={16} aria-hidden="true" />
                New folder
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating("project");
                  setNewName("New project");
                }}
              >
                <Plus size={16} aria-hidden="true" />
                New project
              </button>
            </div>
          )}
        </div>

        {creating !== null && (
          <form className="home-create" onSubmit={create}>
            <label className="field">
              <span>{creating === "project" ? "Project name" : "Folder name"}</span>
              {/* biome-ignore lint/a11y/noAutofocus: the form opens because the user asked to name a new item */}
              <input value={newName} maxLength={120} autoFocus onChange={(event) => setNewName(event.target.value)} />
            </label>
            <button type="submit" disabled={busy || newName.trim() === ""}>
              {creating === "project" ? "Create and open" : "Create"}
            </button>
            <button type="button" className="secondary" onClick={() => setCreating(null)}>
              Cancel
            </button>
            <span className="home-create-where">
              In {target === null || home === null ? "My projects" : pathOf(home, target).map((f) => f.name).join(" / ")}
            </span>
          </form>
        )}

        {problem && (
          <p className="form-problem" role="alert">
            {problem}
          </p>
        )}
        {shown.kind === "trash" && home !== null && (
          <p className="home-note">
            Items in the trash are removed for good {home.trashRetentionDays} days after they were put there, with
            their files. Restore an item to work in it again.
          </p>
        )}

        {loaded.kind === "loading" && <p className="pane-empty">Loading your projects…</p>}
        {home !== null && items.length === 0 && <Empty section={shown} searching={searching} />}
        {home !== null && items.length > 0 && layout === "grid" && (
          <ul className="home-grid" aria-label={`${title}, as a grid`}>
            {items.map((item) => (
              <li key={itemId(item)}>
                <button
                  type="button"
                  className="home-card"
                  aria-pressed={itemId(item) === selectedId}
                  title={shown.kind === "trash" ? itemName(item) : `${itemName(item)}: double-click to open`}
                  onClick={() => setSelectedId(itemId(item))}
                  onDoubleClick={() => open(item)}
                >
                  <Picture item={item} />
                  <span className="home-card-name">{itemName(item)}</span>
                  <span className="home-card-meta">{cardMeta(home, item, shown)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {home !== null && items.length > 0 && layout === "list" && (
          <table className="home-list" aria-label={`${title}, as a list`}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Location</th>
                <th scope="col">{shown.kind === "trash" ? "Put in the trash" : "Last modified"}</th>
                <th scope="col">Last opened</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={itemId(item)} aria-selected={itemId(item) === selectedId}>
                  <td>
                    <button
                      type="button"
                      className="home-row"
                      aria-pressed={itemId(item) === selectedId}
                      onClick={() => setSelectedId(itemId(item))}
                      onDoubleClick={() => open(item)}
                    >
                      {item.kind === "folder" ? <Folder size={16} aria-hidden="true" /> : <Box size={16} aria-hidden="true" />}
                      {itemName(item)}
                    </button>
                  </td>
                  <td>{locationOf(home, item)}</td>
                  <td>{when(shown.kind === "trash" ? deletedAt(item) : item.kind === "folder" ? item.folder.updatedAt : item.project.updatedAt)}</td>
                  <td>{item.kind === "project" ? when(item.project.lastOpenedAt) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>

      <aside className="pane home-info" aria-label="Details">
        {home !== null && selected !== null ? (
          <Info
            key={itemId(selected)}
            home={home}
            item={selected}
            inTrash={shown.kind === "trash"}
            busy={busy}
            onOpen={() => open(selected)}
            onRename={(name) =>
              act(() =>
                selected.kind === "project"
                  ? changeProject(selected.project.id, { name })
                  : changeFolder(selected.folder.id, { name }),
              )
            }
            onMove={(folderId) =>
              act(() =>
                selected.kind === "project"
                  ? changeProject(selected.project.id, { folderId })
                  : changeFolder(selected.folder.id, { parentId: folderId }),
              )
            }
            onDuplicate={() =>
              act(
                () => (selected.kind === "project" ? projectAction(selected.project.id, "duplicate") : folderAction(selected.folder.id, "duplicate")),
                (copy) => setSelectedId(copy.id),
              )
            }
            onTrash={() =>
              act(
                () => (selected.kind === "project" ? projectAction(selected.project.id, "trash") : folderAction(selected.folder.id, "trash")),
                () => setSelectedId(null),
              )
            }
            onRestore={() =>
              act(
                () => (selected.kind === "project" ? projectAction(selected.project.id, "restore") : folderAction(selected.folder.id, "restore")),
                () => setSelectedId(null),
              )
            }
          />
        ) : (
          <>
            <h2 className="pane-title">Details</h2>
            <p className="pane-empty">
              {shown.kind === "trash"
                ? "Choose an item to see when it is removed for good, or to restore it."
                : "Choose a project or folder to see its details. Double-click a project to open it."}
            </p>
          </>
        )}
      </aside>
      {overlays}
      {statusBar}
    </div>
  );
}

function deletedAt(item: Item): string | null {
  return item.kind === "folder" ? item.folder.deletedAt : item.project.deletedAt;
}

function locationOf(home: HomeResponse, item: Item): string {
  const parent = item.kind === "folder" ? item.folder.parentId : item.project.folderId;
  const path = pathOf(home, parent);
  return path.length === 0 ? "My projects" : path.map((f) => f.name).join(" / ");
}

function cardMeta(home: HomeResponse, item: Item, section: Section): string {
  if (section.kind === "trash") {
    const at = deletedAt(item);
    return at === null ? "" : `Removed for good on ${day(purgeDate(at, home.trashRetentionDays))}`;
  }
  if (item.kind === "folder") {
    const count = projectCount(home, item.folder.id);
    return count === 1 ? "1 project" : `${count} projects`;
  }
  return item.project.lastOpenedAt === null ? `Created ${day(new Date(item.project.createdAt))}` : `Opened ${when(item.project.lastOpenedAt)}`;
}

/** A project's thumbnail, or an icon for a project without one and for a folder. */
function Picture({ item }: { item: Item }) {
  const url = item.kind === "project" ? thumbnailUrl(item.project) : null;
  const [failed, setFailed] = useState(false);
  if (url !== null && !failed) {
    return <img className="home-card-picture" src={url} alt="" loading="lazy" onError={() => setFailed(true)} />;
  }
  return (
    <span className={`home-card-picture home-card-icon home-card-${item.kind}`} aria-hidden="true">
      {item.kind === "folder" ? <Folder size={44} strokeWidth={1.4} /> : <Box size={44} strokeWidth={1.4} />}
    </span>
  );
}

function Empty({ section, searching }: { section: Section; searching: boolean }) {
  const text = searching
    ? "No project or folder has that name. Check the spelling, or search for part of the name."
    : section.kind === "recent"
      ? "Projects you open appear here. Open one under My projects, or start a new project."
      : section.kind === "trash"
        ? "The trash is empty."
        : "This folder is empty. Start a new project or folder in it.";
  return (
    <div className="home-empty">
      {section.kind === "trash" ? <Trash2 size={40} strokeWidth={1.3} aria-hidden="true" /> : <FolderOpen size={40} strokeWidth={1.3} aria-hidden="true" />}
      <p>{text}</p>
    </div>
  );
}

/** The folders under one folder in the side bar, as a tree. */
function FolderTree({
  home,
  parentId,
  depth,
  shown,
  onGo,
}: {
  home: HomeResponse;
  parentId: string | null;
  depth: number;
  shown: Section;
  onGo: (section: Section) => void;
}) {
  const folders = liveFolders(home)
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  if (folders.length === 0) return null;
  return (
    <ul className="home-tree" aria-label={parentId === null ? "Folders" : undefined}>
      {folders.map((folder) => (
        <li key={folder.id}>
          <button
            type="button"
            className="home-nav-item"
            style={{ paddingLeft: `${10 + depth * 14}px` }}
            aria-current={shown.kind === "folder" && shown.id === folder.id ? "page" : undefined}
            onClick={() => onGo({ kind: "folder", id: folder.id })}
          >
            <Folder size={15} aria-hidden="true" />
            <span>{folder.name}</span>
          </button>
          <FolderTree home={home} parentId={folder.id} depth={depth + 1} shown={shown} onGo={onGo} />
        </li>
      ))}
    </ul>
  );
}

function Breadcrumb({ home, folderId, onGo }: { home: HomeResponse; folderId: string | null; onGo: (section: Section) => void }) {
  const path = pathOf(home, folderId);
  return (
    <nav aria-label="Folder path" className="home-breadcrumb">
      {path.length === 0 ? (
        <h1>My projects</h1>
      ) : (
        <>
          <button type="button" className="link-button" onClick={() => onGo({ kind: "folder", id: null })}>
            My projects
          </button>
          {path.map((folder, index) => (
            <span key={folder.id} className="home-breadcrumb-step">
              <ChevronRight size={15} aria-hidden="true" />
              {index === path.length - 1 ? (
                <h1>{folder.name}</h1>
              ) : (
                <button type="button" className="link-button" onClick={() => onGo({ kind: "folder", id: folder.id })}>
                  {folder.name}
                </button>
              )}
            </span>
          ))}
        </>
      )}
    </nav>
  );
}

/** The info panel: what the item is, and what can be done with it. */
function Info({
  home,
  item,
  inTrash,
  busy,
  onOpen,
  onRename,
  onMove,
  onDuplicate,
  onTrash,
  onRestore,
}: {
  home: HomeResponse;
  item: Item;
  inTrash: boolean;
  busy: boolean;
  onOpen: () => void;
  onRename: (name: string) => Promise<boolean>;
  onMove: (folderId: string | null) => Promise<boolean>;
  onDuplicate: () => void;
  onTrash: () => void;
  onRestore: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(itemName(item));
  const parent = item.kind === "folder" ? item.folder.parentId : item.project.folderId;
  const [moveTo, setMoveTo] = useState(parent ?? TOP);
  // A folder cannot go into itself or a folder inside it.
  const barred = item.kind === "folder" ? subtreeOf(home, item.folder.id) : new Set<string>();
  const destinations = liveFolders(home)
    .filter((f) => !barred.has(f.id))
    .map((f) => ({ id: f.id, label: pathOf(home, f.id).map((step) => step.name).join(" / ") }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const kind = item.kind === "folder" ? "folder" : "project";

  async function rename(event: FormEvent) {
    event.preventDefault();
    if (await onRename(name)) setRenaming(false);
  }

  const trashedAt = deletedAt(item);
  return (
    <section className="home-details" aria-label={`Details of ${itemName(item)}`}>
      <h2 className="pane-title">{item.kind === "folder" ? "Folder" : "Project"}</h2>
      {item.kind === "project" && (
        <div className="home-details-picture">
          <Picture item={item} />
        </div>
      )}
      {renaming ? (
        <form className="home-rename" onSubmit={rename}>
          <label className="field">
            <span>Name</span>
            {/* biome-ignore lint/a11y/noAutofocus: the field opens because the user asked to rename */}
            <input value={name} maxLength={120} autoFocus onChange={(event) => setName(event.target.value)} />
          </label>
          <button type="submit" disabled={busy || name.trim() === ""}>
            Save name
          </button>
          <button type="button" className="secondary" onClick={() => setRenaming(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <p className="home-details-name">{itemName(item)}</p>
      )}
      <dl className="geometry-facts">
        <dt>Location</dt>
        <dd>{locationOf(home, item)}</dd>
        {item.kind === "project" ? (
          <ProjectFacts project={item.project} />
        ) : (
          <FolderFacts home={home} folder={item.folder} inTrash={inTrash} />
        )}
        {trashedAt !== null && (
          <>
            <dt>Put in the trash</dt>
            <dd>{when(trashedAt)}</dd>
            <dt>Removed for good</dt>
            <dd>{day(purgeDate(trashedAt, home.trashRetentionDays))}</dd>
          </>
        )}
      </dl>
      {inTrash ? (
        <div className="home-actions">
          <button type="button" onClick={onRestore} disabled={busy}>
            <RotateCcw size={15} aria-hidden="true" />
            Restore
          </button>
        </div>
      ) : (
        <>
          <div className="home-actions">
            <button type="button" onClick={onOpen}>
              <FolderOpen size={15} aria-hidden="true" />
              {item.kind === "folder" ? "Open folder" : "Open project"}
            </button>
            <button type="button" className="secondary" onClick={() => setRenaming(true)} disabled={busy || renaming}>
              <Pencil size={15} aria-hidden="true" />
              Rename
            </button>
            <button type="button" className="secondary" onClick={onDuplicate} disabled={busy}>
              <Copy size={15} aria-hidden="true" />
              Duplicate
            </button>
            <button type="button" className="secondary danger" onClick={onTrash} disabled={busy}>
              <Trash2 size={15} aria-hidden="true" />
              Move to trash
            </button>
          </div>
          <form
            className="home-move"
            onSubmit={(event) => {
              event.preventDefault();
              void onMove(moveTo === TOP ? null : moveTo);
            }}
          >
            <label className="field">
              <span>Move to</span>
              <select value={moveTo} onChange={(event) => setMoveTo(event.target.value)}>
                <option value={TOP}>My projects (top)</option>
                {destinations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="secondary" disabled={busy || moveTo === (parent ?? TOP)}>
              <FolderInput size={15} aria-hidden="true" />
              Move
            </button>
          </form>
          {item.kind === "project" ? (
            <p className="home-note">A duplicate holds the geometries and setups, not meshes, runs or reports.</p>
          ) : (
            <p className="home-note">Moving the {kind} to the trash takes everything in it along.</p>
          )}
        </>
      )}
    </section>
  );
}

function ProjectFacts({ project }: { project: ProjectView }) {
  return (
    <>
      <dt>Unit system</dt>
      <dd>{unitSystemName(project.unitSystem)}</dd>
      <dt>Created</dt>
      <dd>{when(project.createdAt)}</dd>
      <dt>Last modified</dt>
      <dd>{when(project.updatedAt)}</dd>
      <dt>Last opened</dt>
      <dd>{when(project.lastOpenedAt)}</dd>
    </>
  );
}

function FolderFacts({ home, folder, inTrash }: { home: HomeResponse; folder: FolderView; inTrash: boolean }) {
  const count = inTrash ? trashedProjectCount(home, folder) : projectCount(home, folder.id);
  return (
    <>
      <dt>Holds</dt>
      <dd>{count === 1 ? "1 project" : `${count} projects`}</dd>
      <dt>Created</dt>
      <dd>{when(folder.createdAt)}</dd>
    </>
  );
}
