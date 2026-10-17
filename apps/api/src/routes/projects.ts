// SPDX-License-Identifier: AGPL-3.0-or-later
// The signed-in user's project and its default unit system (M2.1, ADR-038).
// Shapes: packages/spec/schemas/project.schema.json.

import {
  isUnitSystem,
  type ProjectResponse,
  type ProjectView,
  unitsTable,
  validateProjectUpdate,
} from "@clearfea/spec";
import { Hono } from "hono";
import { readBody } from "../body";
import { type Project, setProjectUnitSystem, userProject } from "../db/projects";
import { requireUser, type SessionEnv } from "../session";

export const projects = new Hono<SessionEnv>();

projects.use("*", requireUser);

/** The project's unit system; a stored system that units.json no longer lists is the table's default. */
export function projectUnitSystem(project: Project): string {
  return project.unitSystem !== null && isUnitSystem(project.unitSystem) ? project.unitSystem : unitsTable.defaultSystem;
}

function projectView(project: Project): ProjectView {
  return { id: project.id, name: project.name, unitSystem: projectUnitSystem(project) };
}

projects.get("/", async (c) => {
  const project = await userProject(c.env.DB, c.var.userId);
  return c.json({ project: projectView(project) } satisfies ProjectResponse);
});

projects.patch("/", async (c) => {
  const body = await readBody(c.req.raw, validateProjectUpdate, "ProjectUpdate", "project.schema.json");
  if ("error" in body) return c.json({ error: body.error }, 400);
  const { unitSystem } = body.value;
  if (!isUnitSystem(unitSystem)) {
    const known = Object.keys(unitsTable.systems).join(", ");
    return c.json({ error: `'${unitSystem}' is not a unit system. Use one of: ${known}.` }, 400);
  }
  const project = await setProjectUnitSystem(c.env.DB, c.var.userId, unitSystem);
  return c.json({ project: projectView(project) } satisfies ProjectResponse);
});
