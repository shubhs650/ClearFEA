// SPDX-License-Identifier: AGPL-3.0-or-later
// What a balance allows (M8.1, ADR-080): a solve is refused when its estimated cost on the size
// it would run on is more than the balance, and meshing (which has no estimate) when the balance
// is not above zero. Pure; the routes read the balance and the estimate.

import { credits } from "@clearfea/spec";

/** Why a run estimated at `cost` micro-credits on `size` cannot start, or null when it can. */
export function runFundsProblem(balance: number, cost: number, size: string): string | null {
  if (cost <= balance) return null;
  return `This run is estimated to cost ${credits(cost)} on the ${size} machine size, and your wallet holds ${credits(balance)}. Open the wallet to see what was charged, or choose a smaller machine size or a coarser mesh.`;
}

/** Why a mesh cannot be made at this balance, or null when it can. */
export function meshFundsProblem(balance: number): string | null {
  if (balance > 0) return null;
  return `Your wallet holds ${credits(balance)}, so a mesh cannot be made. Open the wallet to see what was charged.`;
}
