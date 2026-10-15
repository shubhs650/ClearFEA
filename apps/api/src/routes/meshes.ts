// SPDX-License-Identifier: AGPL-3.0-or-later
// The signed-in user's meshes and the files the viewer draws them from (M1.6, ADR-028). Meshes
// are requested through POST /api/simulations/:id/mesh. Shapes: simulation.schema.json.

import type { MeshResponse, MeshView } from "@clearfea/spec";
import { Hono } from "hono";
import { getMesh, type Mesh, meshKey } from "../db/meshes";
import { requireUser, type SessionEnv } from "../session";

export const meshes = new Hono<SessionEnv>();

meshes.use("*", requireUser);

const NOT_FOUND = "There is no mesh with that id in your account.";

export function meshView(mesh: Mesh): MeshView {
  return {
    id: mesh.id,
    geometryId: mesh.geometryId,
    size: mesh.size,
    order: mesh.order,
    local: mesh.local,
    status: mesh.status,
    problem: mesh.problem,
    nodeCount: mesh.nodeCount,
    elementCount: mesh.elementCount,
    quality: mesh.quality,
    createdAt: mesh.createdAt,
  };
}

meshes.get("/:id", async (c) => {
  const mesh = await getMesh(c.env.DB, c.var.userId, c.req.param("id"));
  // Another user's mesh answers exactly like a missing one, so ids reveal nothing.
  if (mesh === null) return c.json({ error: NOT_FOUND }, 404);
  return c.json({ mesh: meshView(mesh) } satisfies MeshResponse);
});

/** The mesh's surface for the viewer, in the display mesh format (packages/spec/display-mesh.md). */
meshes.get("/:id/display", async (c) => {
  const mesh = await getMesh(c.env.DB, c.var.userId, c.req.param("id"));
  if (mesh === null) return c.json({ error: NOT_FOUND }, 404);
  if (mesh.status !== "ready") {
    const why =
      mesh.status === "meshing"
        ? "The mesh is still being made. Try again when it has finished."
        : "Meshing failed, so there is no mesh to show. Change the mesh size and generate it again.";
    return c.json({ error: why }, 409);
  }
  const object = await c.env.FILES.get(meshKey(c.var.userId, mesh.id, "display.bin"));
  if (object === null) {
    return c.json({ error: "The display file of this mesh is missing from storage. Generate the mesh again." }, 500);
  }
  return c.body(object.body, 200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(object.size),
  });
});
