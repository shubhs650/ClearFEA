// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/storage.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/storage.schema.json";
import { validator } from "../validate";

/**
 * What stored files are: geometry (the STEP file, topology and display mesh), mesh (volume and display meshes), results (a run's solver input, log and viewer files, kept permanently), rawOutput (a run's results.frd and results.dat, kept for the retention period unless the run is pinned), report (reports, report figures and the report logo).
 *
 * This interface was referenced by `Storage`'s JSON-Schema
 * via the `definition` "StorageKind".
 */
export type StorageKind = "geometry" | "mesh" | "results" | "rawOutput" | "report";

/**
 * Wire shapes of the storage route (M8.6, ADR-086; docs/ARCHITECTURE.md section 4). Sizes are in bytes; money is in whole micro-credits (1,000,000 is one credit). Each message is a definition under $defs.
 */
export interface Storage {
  [k: string]: unknown;
}
/**
 * The bytes and number of files of one kind.
 *
 * This interface was referenced by `Storage`'s JSON-Schema
 * via the `definition` "StoragePart".
 */
export interface StoragePart {
  kind: StorageKind;
  bytes: number;
  files: number;
}
/**
 * A run that holds raw solver output, with its size and what happens to it.
 *
 * This interface was referenced by `Storage`'s JSON-Schema
 * via the `definition` "StorageRun".
 */
export interface StorageRun {
  id: string;
  simulationId: string;
  simulationName: string;
  startedAt: string;
  bytes: number;
  pinned: boolean;
  /**
   * When the retention period ends; null when the run is pinned.
   */
  keptUntil: string | null;
}
/**
 * The signed-in user's storage: every file kept for them, by kind, against the free allowance, and the runs that hold raw solver output, newest first. The daily sweep removes raw output past its retention period and charges the bytes above the allowance at the rate per GiB per day.
 *
 * This interface was referenced by `Storage`'s JSON-Schema
 * via the `definition` "StorageView".
 */
export interface StorageView {
  usedBytes: number;
  /**
   * The free allowance.
   */
  freeBytes: number;
  /**
   * Micro-credits per GiB per day stored above the allowance.
   */
  ratePerGibDay: number;
  /**
   * Days raw solver output is kept after a run ends unless the run is pinned.
   */
  retentionDays: number;
  /**
   * One entry per kind, in the order of StorageKind.
   */
  parts: StoragePart[];
  runs: StorageRun[];
}
/**
 * Answer to GET /api/storage.
 *
 * This interface was referenced by `Storage`'s JSON-Schema
 * via the `definition` "StorageResponse".
 */
export interface StorageResponse {
  storage: StorageView;
}

export const StorageKindValues = ["geometry", "mesh", "results", "rawOutput", "report"] as const satisfies readonly StorageKind[];
export const validateStorageKind = validator<StorageKind>(schema, "StorageKind");
export const validateStoragePart = validator<StoragePart>(schema, "StoragePart");
export const validateStorageRun = validator<StorageRun>(schema, "StorageRun");
export const validateStorageView = validator<StorageView>(schema, "StorageView");
export const validateStorageResponse = validator<StorageResponse>(schema, "StorageResponse");
