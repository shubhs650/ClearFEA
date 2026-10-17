// SPDX-License-Identifier: AGPL-3.0-or-later
// Self-hosting mode (M8.10, ADR-084): the wallet is informational. Jobs are metered and charged
// to the ledger as usual, so the wallet shows what the work would cost, but a balance never
// refuses a run or a mesh.

import type { Env } from "./env";

/** True when `SELF_HOSTED` is set to `true` or `1` (any case). Unset or anything else is the hosted mode. */
export function selfHosted(env: Pick<Env, "SELF_HOSTED">): boolean {
  const value = env.SELF_HOSTED?.trim().toLowerCase();
  return value === "true" || value === "1";
}
