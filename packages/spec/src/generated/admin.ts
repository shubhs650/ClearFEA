// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/admin.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/admin.schema.json";
import { validator } from "../validate";

/**
 * Wire shapes of the admin routes (M10.3, ADR-097): the allowlist of addresses that may sign in with Google, the users, the cloud machine sizes (M10.6) and the solver machines started on AWS (M10.7). Only the admin reaches them. Each message is a definition under $defs.
 */
export interface Admin {
  [k: string]: unknown;
}
/**
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "AllowedEmail".
 */
export interface AllowedEmail {
  /**
   * Lower case.
   */
  email: string;
  /**
   * ISO 8601 UTC.
   */
  addedAt: string;
}
/**
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "AdminUser".
 */
export interface AdminUser {
  id: string;
  name: string;
  /**
   * Null for a seeded local test user without one.
   */
  email: string | null;
  createdAt: string;
  /**
   * When their latest Google session started, or null.
   */
  lastSignIn: string | null;
  /**
   * Billed machine seconds of their jobs that finished this calendar month (UTC).
   */
  machineSecondsThisMonth: number;
  /**
   * True when their address may sign in now: the admin's, or on the allowlist.
   */
  allowed: boolean;
}
/**
 * A machine size the live site can run on AWS (M10.6, ADR-099).
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "CloudMachineSize".
 */
export interface CloudMachineSize {
  name: string;
  cores: number;
  memoryBytes: number;
  /**
   * Switched on: runs on the live site may choose it.
   */
  enabled: boolean;
  /**
   * The default size, which runs every import, mesh and report job and cannot be switched off.
   */
  default: boolean;
}
/**
 * One solver machine the API asked AWS to start (M10.7, ADR-100).
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "MachineStart".
 */
export interface MachineStart {
  /**
   * A machine_sizes name: medium (standard) or large.
   */
  size: string;
  /**
   * ISO 8601 UTC.
   */
  requestedAt: string;
  /**
   * starting: asked for, its worker not seen yet; running: its worker made contact in the last minute; ended: its worker was seen and has stopped; failed: AWS refused it or its worker never made contact.
   */
  state: "starting" | "running" | "ended" | "failed";
  /**
   * Why AWS refused the start, in AWS's words; null otherwise.
   */
  problem: string | null;
}
/**
 * The live site's solver machines and their monthly cap (M10.7, ADR-100).
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "SolverMachines".
 */
export interface SolverMachines {
  /**
   * ready: the API can start machines on AWS; not_set_up: it runs on cloud machines but lacks what starting one needs, which problem names; local: jobs run on the local worker and nothing is started.
   */
  launcher: "ready" | "not_set_up" | "local";
  problem: string | null;
  /**
   * Machine hours used this calendar month (UTC), from each start to its worker's last contact.
   */
  hoursThisMonth: number;
  /**
   * The monthly machine-hours cap; 0 pauses the solver.
   */
  hoursCap: number;
  /**
   * The latest starts, newest first, at most 10.
   */
  starts: MachineStart[];
}
/**
 * Answer to GET /api/admin and to adding or removing an address.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "AdminResponse".
 */
export interface AdminResponse {
  /**
   * The admin's address from the API's configuration (ADMIN_EMAIL), lower case.
   */
  adminEmail: string;
  allowed: AllowedEmail[];
  users: AdminUser[];
  /**
   * Where jobs run: cloud machines (the live site, MACHINES=cloud) or the local worker, which simulates every size and ignores the cloud size list.
   */
  machines: "cloud" | "local";
  cloudSizes: CloudMachineSize[];
  solverMachines: SolverMachines;
}
/**
 * Body of PUT /api/admin/machine-sizes/{name}.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "SwitchCloudSizeRequest".
 */
export interface SwitchCloudSizeRequest {
  enabled: boolean;
}
/**
 * Body of PUT /api/admin/machine-hours-cap.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "SetMachineHoursCapRequest".
 */
export interface SetMachineHoursCapRequest {
  /**
   * Machine hours per calendar month (UTC); 744 is one machine for a whole month.
   */
  hours: number;
}
/**
 * Body of POST /api/admin/allowed.
 *
 * This interface was referenced by `Admin`'s JSON-Schema
 * via the `definition` "AddAllowedRequest".
 */
export interface AddAllowedRequest {
  email: string;
}

export const validateAllowedEmail = validator<AllowedEmail>(schema, "AllowedEmail");
export const validateAdminUser = validator<AdminUser>(schema, "AdminUser");
export const validateCloudMachineSize = validator<CloudMachineSize>(schema, "CloudMachineSize");
export const validateMachineStart = validator<MachineStart>(schema, "MachineStart");
export const validateSolverMachines = validator<SolverMachines>(schema, "SolverMachines");
export const validateAdminResponse = validator<AdminResponse>(schema, "AdminResponse");
export const validateSwitchCloudSizeRequest = validator<SwitchCloudSizeRequest>(schema, "SwitchCloudSizeRequest");
export const validateSetMachineHoursCapRequest = validator<SetMachineHoursCapRequest>(schema, "SetMachineHoursCapRequest");
export const validateAddAllowedRequest = validator<AddAllowedRequest>(schema, "AddAllowedRequest");
