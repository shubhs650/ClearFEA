// SPDX-License-Identifier: AGPL-3.0-or-later
// The signed-in user's projects and folders (M2.1, ADR-038; M14.2, ADR-114, ADR-124): the home
// with every folder and project, create, rename, move, duplicate, trash and restore. /api/project
// is the user's oldest project outside the trash, which the workbench uses until the home page
// opens a chosen project (M14.3). Shapes: packages/spec/schemas/project.schema.json.

import {
  type DuplicateRequest,
  type FolderResponse,
  type FolderView,
  type HomeResponse,
  isUnitSystem,
  type ProjectResponse,
  type ProjectView,
  unitsTable,
  validateDuplicateRequest,
  validateFolderChange,
  validateFolderCreate,
  validateProjectChange,
  validateProjectCreate,
  validateProjectUpdate,
} from "@clearfea/spec";
import { type Context, Hono } from "hono";
import { readBody } from "../body";
import { imageInfo } from "../logo";
import { type DuplicateRefusal, duplicateFolder, duplicateProject, MAX_DUPLICATED_GEOMETRIES } from "../db/duplicate";
import {
  changeFolder,
  changeProject,
  createFolder,
  createProject,
  type Folder,
  getProject,
  isRefusal,
  listHome,
  markProjectOpened,
  markProjectThumbnail,
  type Project,
  projectThumbnailKey,
  restoreFolder,
  restoreProject,
  setProjectUnitSystem,
  trashCutoff,
  trashFolder,
  trashProject,
  userProject,
} from "../db/projects";
import { trashRetentionDays } from "../db/settings";
import { requireUser, type SessionEnv } from "../session";

export const projects = new Hono<SessionEnv>();
export const home = new Hono<SessionEnv>();
export const folders = new Hono<SessionEnv>();

projects.use("*", requireUser);
home.use("*", requireUser);
folders.use("*", requireUser);

/** The project's unit system; a stored system that units.json no longer lists is the table's default. */
export function projectUnitSystem(project: Project | null): string {
  return project !== null && project.unitSystem !== null && isUnitSystem(project.unitSystem)
    ? project.unitSystem
    : unitsTable.defaultSystem;
}

function projectView(project: Project): ProjectView {
  return {
    id: project.id,
    name: project.name,
    unitSystem: projectUnitSystem(project),
    folderId: project.folderId,
    deletedAt: project.deletedAt,
    lastOpenedAt: project.lastOpenedAt,
    thumbnailAt: project.thumbnailAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function folderView(folder: Folder): FolderView {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    deletedAt: folder.deletedAt,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  };
}

function unknownUnitSystem(unitSystem: string): string {
  const known = Object.keys(unitsTable.systems).join(", ");
  return `'${unitSystem}' is not a unit system. Use one of: ${known}.`;
}

type AnyContext = Context<SessionEnv>;

/** Answers a refused change in plain language, naming what to do. */
async function refusal(c: AnyContext, kind: "project" | "folder", why: DuplicateRefusal): Promise<Response> {
  switch (why) {
    case "notFound":
      return c.json({ error: `There is no ${kind} with that id in your account.` }, 404);
    case "inTrash":
      return c.json({ error: `The ${kind} is in the trash. Restore it first.` }, 409);
    case "folderNotFound":
      return c.json(
        {
          error:
            "There is no folder with that id in your account outside the trash. Choose another folder, or the top of your home.",
        },
        400,
      );
    case "cycle":
      return c.json({ error: "A folder cannot go inside itself or inside a folder within it. Choose another folder." }, 400);
    case "expired": {
      const days = await trashRetentionDays(c.env.DB);
      return c.json(
        {
          error: `The ${kind} has been in the trash for more than ${days} days and is being removed for good, so it can no longer be restored.`,
        },
        409,
      );
    }
    case "busy":
      return c.json(
        { error: `A geometry in the ${kind} is still being imported. Wait for the import to finish, then duplicate it.` },
        409,
      );
    case "tooLarge":
      return c.json(
        {
          error: `The copy would hold more than ${MAX_DUPLICATED_GEOMETRIES} geometries, the most one duplicate copies. Duplicate the projects in it one at a time.`,
        },
        400,
      );
  }
}

/** A name with the spaces at either end removed, or null when nothing is left. */
function trimmed(name: string | undefined): string | null | undefined {
  if (name === undefined) return undefined;
  const value = name.trim();
  return value === "" ? null : value;
}

const EMPTY_NAME = "Give a name with at least one letter or digit in it.";

/** A duplicate's body, which may be left out. */
async function duplicateBody(c: AnyContext): Promise<{ value: DuplicateRequest } | { error: string }> {
  if ((await c.req.raw.clone().text()).trim() === "") return { value: {} };
  return readBody(c.req.raw, validateDuplicateRequest, "DuplicateRequest", "project.schema.json");
}

// The user's oldest project outside the trash (ADR-038), as the workbench has used it since M2.1.

projects.get("/", async (c) => {
  const project = await userProject(c.env.DB, c.var.userId);
  return c.json({ project: projectView(project) } satisfies ProjectResponse);
});

projects.patch("/", async (c) => {
  const body = await readBody(c.req.raw, validateProjectUpdate, "ProjectUpdate", "project.schema.json");
  if ("error" in body) return c.json({ error: body.error }, 400);
  const { unitSystem } = body.value;
  if (!isUnitSystem(unitSystem)) return c.json({ error: unknownUnitSystem(unitSystem) }, 400);
  const project = await setProjectUnitSystem(c.env.DB, c.var.userId, unitSystem);
  return c.json({ project: projectView(project) } satisfies ProjectResponse);
});

// The home: every folder and project, and the routes that act on one project.

home.get("/", async (c) => {
  // Made here too, so a new user's home is never empty and their first upload has a project.
  await userProject(c.env.DB, c.var.userId);
  const [{ folders: folderList, projects: projectList }, retention] = await Promise.all([
    listHome(c.env.DB, c.var.userId),
    trashRetentionDays(c.env.DB),
  ]);
  return c.json({
    folders: folderList.map(folderView),
    projects: projectList.map(projectView),
    trashRetentionDays: retention,
  } satisfies HomeResponse);
});

home.post("/", async (c) => {
  const body = await readBody(c.req.raw, validateProjectCreate, "ProjectCreate", "project.schema.json");
  if ("error" in body) return c.json({ error: body.error }, 400);
  const name = trimmed(body.value.name);
  if (!name) return c.json({ error: EMPTY_NAME }, 400);
  const project = await createProject(c.env.DB, c.var.userId, {
    id: crypto.randomUUID(),
    name,
    folderId: body.value.folderId ?? null,
  });
  if (project === null) return refusal(c, "project", "folderNotFound");
  return c.json({ project: projectView(project) } satisfies ProjectResponse, 201);
});

home.get("/:id", async (c) => {
  const project = await getProject(c.env.DB, c.var.userId, c.req.param("id"));
  if (project === null) return refusal(c, "project", "notFound");
  return c.json({ project: projectView(project) } satisfies ProjectResponse);
});

home.patch("/:id", async (c) => {
  const body = await readBody(c.req.raw, validateProjectChange, "ProjectChange", "project.schema.json");
  if ("error" in body) return c.json({ error: body.error }, 400);
  const name = trimmed(body.value.name);
  if (name === null) return c.json({ error: EMPTY_NAME }, 400);
  const { unitSystem, folderId } = body.value;
  if (unitSystem !== undefined && !isUnitSystem(unitSystem)) return c.json({ error: unknownUnitSystem(unitSystem) }, 400);
  const result = await changeProject(c.env.DB, c.var.userId, c.req.param("id"), { name, folderId, unitSystem });
  if (isRefusal(result)) return refusal(c, "project", result);
  return c.json({ project: projectView(result) } satisfies ProjectResponse);
});

/** Records that the user opened the project, for Recent on the home page. */
home.post("/:id/opened", async (c) => {
  const id = c.req.param("id");
  if (!(await markProjectOpened(c.env.DB, c.var.userId, id))) return refusal(c, "project", "notFound");
  const project = await getProject(c.env.DB, c.var.userId, id);
  if (project === null) return refusal(c, "project", "notFound");
  return c.json({ project: projectView(project) } satisfies ProjectResponse);
});

/** The most a thumbnail may hold: the home shows it a few hundred pixels wide. */
export const MAX_THUMBNAIL_BYTES = 500 * 1000;
export const MAX_THUMBNAIL_PIXELS = 1024;

/**
 * Stores the project's thumbnail (M14.3): a PNG the browser draws with the viewer, sent as the
 * raw body like a report figure, so a cross-site form cannot send it without the browser asking.
 */
home.put("/:id/thumbnail", async (c) => {
  if ((c.req.header("Content-Type") ?? "").split(";")[0]?.trim() !== "application/octet-stream") {
    return c.json({ error: "Send the thumbnail as the request body with Content-Type: application/octet-stream." }, 415);
  }
  const tooLarge = `The thumbnail is larger than ${MAX_THUMBNAIL_BYTES / 1000} kB. Send a smaller picture.`;
  if (Number(c.req.header("Content-Length") ?? Number.NaN) > MAX_THUMBNAIL_BYTES) return c.json({ error: tooLarge }, 413);
  const id = c.req.param("id");
  const project = await getProject(c.env.DB, c.var.userId, id);
  if (project === null) return refusal(c, "project", "notFound");
  if (project.deletedAt !== null) return refusal(c, "project", "inTrash");
  const content = new Uint8Array(await c.req.arrayBuffer());
  if (content.byteLength > MAX_THUMBNAIL_BYTES) return c.json({ error: tooLarge }, 413);
  const info = imageInfo(content);
  if (info?.contentType !== "image/png") return c.json({ error: "A thumbnail must be a PNG image." }, 400);
  if (info.width > MAX_THUMBNAIL_PIXELS || info.height > MAX_THUMBNAIL_PIXELS) {
    return c.json({ error: `A thumbnail must be at most ${MAX_THUMBNAIL_PIXELS} pixels wide and high.` }, 400);
  }
  await c.env.FILES.put(projectThumbnailKey(c.var.userId, id), content, { httpMetadata: { contentType: "image/png" } });
  const result = await markProjectThumbnail(c.env.DB, c.var.userId, id);
  if (isRefusal(result)) return refusal(c, "project", result);
  return c.json({ project: projectView(result) } satisfies ProjectResponse);
});

home.get("/:id/thumbnail", async (c) => {
  const id = c.req.param("id");
  const project = await getProject(c.env.DB, c.var.userId, id);
  if (project === null) return refusal(c, "project", "notFound");
  const object = project.thumbnailAt === null ? null : await c.env.FILES.get(projectThumbnailKey(c.var.userId, id));
  if (object === null) return c.json({ error: "This project has no thumbnail yet. Open it and show its geometry." }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(object.size),
      // The home asks with ?at=<thumbnailAt>, so a new picture has a new address.
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

home.post("/:id/duplicate", async (c) => {
  const body = await duplicateBody(c);
  if ("error" in body) return c.json({ error: body.error }, 400);
  const name = trimmed(body.value.name);
  if (name === null) return c.json({ error: EMPTY_NAME }, 400);
  const result = await duplicateProject(c.env.DB, c.env.FILES, c.var.userId, c.req.param("id"), {
    name,
    folderId: body.value.folderId,
  });
  if (isRefusal(result)) return refusal(c, "project", result);
  return c.json({ project: projectView(result) } satisfies ProjectResponse, 201);
});

home.post("/:id/trash", async (c) => {
  const result = await trashProject(c.env.DB, c.var.userId, c.req.param("id"));
  if (isRefusal(result)) return refusal(c, "project", result);
  return c.json({ project: projectView(result) } satisfies ProjectResponse);
});

home.post("/:id/restore", async (c) => {
  const cutoff = trashCutoff(new Date(), await trashRetentionDays(c.env.DB));
  const result = await restoreProject(c.env.DB, c.var.userId, c.req.param("id"), cutoff);
  if (isRefusal(result)) return refusal(c, "project", result);
  return c.json({ project: projectView(result) } satisfies ProjectResponse);
});

// Folders.

folders.post("/", async (c) => {
  const body = await readBody(c.req.raw, validateFolderCreate, "FolderCreate", "project.schema.json");
  if ("error" in body) return c.json({ error: body.error }, 400);
  const name = trimmed(body.value.name);
  if (!name) return c.json({ error: EMPTY_NAME }, 400);
  const folder = await createFolder(c.env.DB, c.var.userId, {
    id: crypto.randomUUID(),
    name,
    parentId: body.value.parentId ?? null,
  });
  if (folder === null) return refusal(c, "folder", "folderNotFound");
  return c.json({ folder: folderView(folder) } satisfies FolderResponse, 201);
});

folders.patch("/:id", async (c) => {
  const body = await readBody(c.req.raw, validateFolderChange, "FolderChange", "project.schema.json");
  if ("error" in body) return c.json({ error: body.error }, 400);
  const name = trimmed(body.value.name);
  if (name === null) return c.json({ error: EMPTY_NAME }, 400);
  const result = await changeFolder(c.env.DB, c.var.userId, c.req.param("id"), { name, parentId: body.value.parentId });
  if (isRefusal(result)) return refusal(c, "folder", result);
  return c.json({ folder: folderView(result) } satisfies FolderResponse);
});

folders.post("/:id/duplicate", async (c) => {
  const body = await duplicateBody(c);
  if ("error" in body) return c.json({ error: body.error }, 400);
  const name = trimmed(body.value.name);
  if (name === null) return c.json({ error: EMPTY_NAME }, 400);
  const result = await duplicateFolder(c.env.DB, c.env.FILES, c.var.userId, c.req.param("id"), {
    name,
    folderId: body.value.folderId,
  });
  if (isRefusal(result)) return refusal(c, "folder", result);
  return c.json({ folder: folderView(result) } satisfies FolderResponse, 201);
});

folders.post("/:id/trash", async (c) => {
  const result = await trashFolder(c.env.DB, c.var.userId, c.req.param("id"));
  if (isRefusal(result)) return refusal(c, "folder", result);
  return c.json({ folder: folderView(result) } satisfies FolderResponse);
});

folders.post("/:id/restore", async (c) => {
  const cutoff = trashCutoff(new Date(), await trashRetentionDays(c.env.DB));
  const result = await restoreFolder(c.env.DB, c.var.userId, c.req.param("id"), cutoff);
  if (isRefusal(result)) return refusal(c, "folder", result);
  return c.json({ folder: folderView(result) } satisfies FolderResponse);
});
