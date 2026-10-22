// SPDX-License-Identifier: AGPL-3.0-or-later
// Self-hosting mode (M8.10, ADR-084): the wallet is informational. Jobs are metered and charged
// to the ledger as usual, so the wallet shows what the work would cost, but a balance never
// refuses a run or a mesh.

import { vpsMachines } from "./db/machines";
import type { Env } from "./env";

/** True when `SELF_HOSTED` is set to `true` or `1` (any case). Unset or anything else is the hosted mode. */
export function selfHosted(env: Pick<Env, "SELF_HOSTED">): boolean {
  const value = env.SELF_HOSTED?.trim().toLowerCase();
  return value === "true" || value === "1";
}

/**
 * True when a balance may refuse a run or a mesh: never in self-hosting mode, and never during
 * the closed beta on the solver host, whose wallet shows usage only (ADR-106 item 6).
 */
export function balanceRefuses(env: Pick<Env, "SELF_HOSTED" | "MACHINES">): boolean {
  return !selfHosted(env) && !vpsMachines(env);
}
