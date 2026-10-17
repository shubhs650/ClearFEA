// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/wallet.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/wallet.schema.json";
import { validator } from "../validate";

/**
 * What a ledger entry is for: a play-money credit grant, or the charge for a mesh or solve job (ADR-033).
 *
 * This interface was referenced by `Wallet`'s JSON-Schema
 * via the `definition` "LedgerReason".
 */
export type LedgerReason = "grant" | "mesh" | "solve";

/**
 * Wire shapes of the wallet route (M8.1, ADR-080; docs/ARCHITECTURE.md sections 4 and 6). Money is in whole micro-credits: 1,000,000 is one credit. Each message is a definition under $defs.
 */
export interface Wallet {
  [k: string]: unknown;
}
/**
 * The job a charge is for: the machine size and rate it was queued with and the seconds billed (ADR-033).
 *
 * This interface was referenced by `Wallet`'s JSON-Schema
 * via the `definition` "LedgerJob".
 */
export interface LedgerJob {
  id: string;
  machineSize: string;
  /**
   * Micro-credits per hour of billable time.
   */
  ratePerHour: number;
  billedSeconds: number;
}
/**
 * The run a solve charge paid for.
 *
 * This interface was referenced by `Wallet`'s JSON-Schema
 * via the `definition` "LedgerRun".
 */
export interface LedgerRun {
  id: string;
  simulationId: string;
  simulationName: string;
  startedAt: string;
  status: "solving" | "succeeded" | "failed" | "cancelled";
}
/**
 * The mesh a mesh charge paid for. A mesh belongs to a geometry and may serve several simulations (ADR-047), so it is named by its geometry. Counts are null when meshing failed.
 *
 * This interface was referenced by `Wallet`'s JSON-Schema
 * via the `definition` "LedgerMesh".
 */
export interface LedgerMesh {
  id: string;
  geometryName: string;
  elements: number | null;
  nodes: number | null;
}
/**
 * One ledger entry, as the append-only ledger holds it, with what it paid for. amount is negative for a charge; balance is the balance after the entry. job, run and mesh are null where they do not apply.
 *
 * This interface was referenced by `Wallet`'s JSON-Schema
 * via the `definition` "WalletEntry".
 */
export interface WalletEntry {
  seq: number;
  createdAt: string;
  reason: LedgerReason;
  amount: number;
  balance: number;
  job: LedgerJob | null;
  run: LedgerRun | null;
  mesh: LedgerMesh | null;
}
/**
 * The signed-in user's wallet: the balance (the last entry's balance, 0 with no entries), what was granted and charged in all, and every ledger entry, newest first. granted + charged equals balance.
 *
 * This interface was referenced by `Wallet`'s JSON-Schema
 * via the `definition` "WalletView".
 */
export interface WalletView {
  balance: number;
  granted: number;
  /**
   * The sum of the charges, zero or negative.
   */
  charged: number;
  entries: WalletEntry[];
}
/**
 * Answer to GET /api/wallet.
 *
 * This interface was referenced by `Wallet`'s JSON-Schema
 * via the `definition` "WalletResponse".
 */
export interface WalletResponse {
  wallet: WalletView;
}

export const LedgerReasonValues = ["grant", "mesh", "solve"] as const satisfies readonly LedgerReason[];
export const validateLedgerReason = validator<LedgerReason>(schema, "LedgerReason");
export const validateLedgerJob = validator<LedgerJob>(schema, "LedgerJob");
export const validateLedgerRun = validator<LedgerRun>(schema, "LedgerRun");
export const validateLedgerMesh = validator<LedgerMesh>(schema, "LedgerMesh");
export const validateWalletEntry = validator<WalletEntry>(schema, "WalletEntry");
export const validateWalletView = validator<WalletView>(schema, "WalletView");
export const validateWalletResponse = validator<WalletResponse>(schema, "WalletResponse");
