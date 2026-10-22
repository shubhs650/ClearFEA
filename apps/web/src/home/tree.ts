// SPDX-License-Identifier: AGPL-3.0-or-later
// What the projects home shows (M14.3, ADR-114, ADR-124), worked out from the one listing the
// API answers: the contents of a folder, Recent, the top of the trash, a search, and the order
// the user sorts by. Pure functions, so the page only draws them.

import type { FolderView, HomeResponse, ProjectView } from "@clearfea/spec";

export type Item = { kind: "folder"; folder: FolderView } | { kind: "project"; project: ProjectView };

export type Sort = "opened" | "name" | "modified" | "created";

export const SORTS: Record<Sort, string> = {
  opened: "Last opened",
  name: "Name",
  modified: "Last modified",
  created: "Created",
};

/** How many projects Recent shows. */
export const RECENT_COUNT = 12;

export const itemId = (item: Item): string => (item.kind === "folder" ? item.folder.id : item.project.id);
export const itemName = (item: Item): string => (item.kind === "folder" ? item.folder.name : item.project.name);
const itemOf = {
  folder: (folder: FolderView): Item => ({ kind: "folder", folder }),
  project: (project: ProjectView): Item => ({ kind: "project", project }),
};

/** The folders outside the trash. */
export function liveFolders(home: HomeResponse): FolderView[] {
  return home.folders.filter((f) => f.deletedAt === null);
}

/** The folders and projects outside the trash directly in a folder, or at the top for null. */
export function contentsOf(home: HomeResponse, folderId: string | null): Item[] {
  return [
    ...liveFolders(home)
      .filter((f) => f.parentId === folderId)
      .map(itemOf.folder),
    ...home.projects.filter((p) => p.deletedAt === null && p.folderId === folderId).map(itemOf.project),
  ];
}

/** The folders from the top of the home down to this one, outermost first. */
export function pathOf(home: HomeResponse, folderId: string | null): FolderView[] {
  const byId = new Map(home.folders.map((f) => [f.id, f]));
  const path: FolderView[] = [];
  let at = folderId === null ? undefined : byId.get(folderId);
  // A folder is never inside itself (the API refuses it), but a bad listing must not hang the page.
  while (at !== undefined && path.length <= home.folders.length) {
    path.unshift(at);
    at = at.parentId === null ? undefined : byId.get(at.parentId);
  }
  return path;
}

/** The folder and every folder inside it, at any depth. */
export function subtreeOf(home: HomeResponse, folderId: string): Set<string> {
  const ids = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of home.folders) {
      if (f.parentId !== null && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** How many projects outside the trash a folder holds, at any depth. */
export function projectCount(home: HomeResponse, folderId: string): number {
  const ids = subtreeOf(home, folderId);
  return home.projects.filter((p) => p.deletedAt === null && p.folderId !== null && ids.has(p.folderId)).length;
}

/** The projects opened most recently, outside the trash, newest first. */
export function recentOf(home: HomeResponse): Item[] {
  return home.projects
    .filter((p) => p.deletedAt === null && p.lastOpenedAt !== null)
    .sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""))
    .slice(0, RECENT_COUNT)
    .map(itemOf.project);
}

/**
 * What the trash shows at its top (ADR-124 item 3): an item whose folder is outside the trash, or
 * went there at another time. The rest went with their folder and come back with it.
 */
export function trashOf(home: HomeResponse): Item[] {
  const folders = new Map(home.folders.map((f) => [f.id, f]));
  const onTop = (deletedAt: string | null, folderId: string | null) =>
    deletedAt !== null && (folderId === null || folders.get(folderId)?.deletedAt !== deletedAt);
  return [
    ...home.folders.filter((f) => onTop(f.deletedAt, f.parentId)).map(itemOf.folder),
    ...home.projects.filter((p) => onTop(p.deletedAt, p.folderId)).map(itemOf.project),
  ];
}

/** How many projects went to the trash with a folder in it. */
export function trashedProjectCount(home: HomeResponse, folder: FolderView): number {
  const ids = subtreeOf(home, folder.id);
  return home.projects.filter((p) => p.deletedAt === folder.deletedAt && p.folderId !== null && ids.has(p.folderId)).length;
}

/** Folders and projects outside the trash whose name holds the text, ignoring case. */
export function searchOf(home: HomeResponse, text: string): Item[] {
  const wanted = text.trim().toLocaleLowerCase();
  if (wanted === "") return [];
  const matches = (name: string) => name.toLocaleLowerCase().includes(wanted);
  return [
    ...liveFolders(home)
      .filter((f) => matches(f.name))
      .map(itemOf.folder),
    ...home.projects.filter((p) => p.deletedAt === null && matches(p.name)).map(itemOf.project),
  ];
}

/** The time an item sorts by, as ISO text; a folder has no time it was opened, so it uses its change. */
function timeOf(item: Item, sort: Exclude<Sort, "name">): string {
  if (item.kind === "folder") return sort === "created" ? item.folder.createdAt : item.folder.updatedAt;
  const { project } = item;
  if (sort === "opened") return project.lastOpenedAt ?? project.createdAt;
  return sort === "created" ? project.createdAt : project.updatedAt;
}

/** Folders first, then projects, each by name A to Z or by the chosen time, newest first. */
export function sortItems(items: readonly Item[], sort: Sort): Item[] {
  const byName = (a: Item, b: Item) => itemName(a).localeCompare(itemName(b), undefined, { numeric: true, sensitivity: "base" });
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    if (sort === "name") return byName(a, b);
    return timeOf(b, sort).localeCompare(timeOf(a, sort)) || byName(a, b);
  });
}

/** When an item in the trash is removed for good. */
export function purgeDate(deletedAt: string, retentionDays: number): Date {
  return new Date(Date.parse(deletedAt) + retentionDays * 86_400_000);
}
