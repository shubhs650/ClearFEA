// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/health.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/health.schema.json";
import { validator } from "../validate";

/**
 * Body of GET /api/health. HTTP 200 when status is ok, 503 when degraded.
 */
export interface HealthResponse {
  status: "ok" | "degraded";
  /**
   * "ok", or what is wrong with the database and how to fix it.
   */
  database: string;
  /**
   * "ok", or what is wrong with file storage and how to fix it.
   */
  storage: string;
}

export const validateHealthResponse = validator<HealthResponse>(schema);
