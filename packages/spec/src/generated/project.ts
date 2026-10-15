// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/project.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/project.schema.json";
import { validator } from "../validate";

/**
 * Wire shapes of the project routes (docs/ARCHITECTURE.md section 4, ADR-038). In Phase 0 each user has one project, created when first asked for. Each message is a definition under $defs.
 */
export interface Project {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `Project`'s JSON-Schema
 * via the `definition` "ProjectView".
 */
export interface ProjectView {
  id: string;
  name: string;
  /**
   * Id of a unit system in packages/spec/units.json: the unit every quantity field offers first and the unit results are shown in.
   */
  unitSystem: string;
}
/**
 * Answer to GET /api/project and PATCH /api/project.
 *
 * This interface was referenced by `Project`'s JSON-Schema
 * via the `definition` "ProjectResponse".
 */
export interface ProjectResponse {
  project: ProjectView;
}
/**
 * Body of PATCH /api/project. The unit system must be one units.json lists.
 *
 * This interface was referenced by `Project`'s JSON-Schema
 * via the `definition` "ProjectUpdate".
 */
export interface ProjectUpdate {
  unitSystem: string;
}

export const validateProjectView = validator<ProjectView>(schema, "ProjectView");
export const validateProjectResponse = validator<ProjectResponse>(schema, "ProjectResponse");
export const validateProjectUpdate = validator<ProjectUpdate>(schema, "ProjectUpdate");
