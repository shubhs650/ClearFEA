// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for /api/wallet (M8.1, ADR-080). Shapes: packages/spec/schemas/wallet.schema.json.

import { validateWalletResponse, type WalletView } from "@clearfea/spec";
import { type ApiResult, apiRequest } from "./request";

/** The signed-in user's balance and ledger, newest entry first. */
export async function fetchWallet(): Promise<ApiResult<WalletView>> {
  const result = await apiRequest("GET", "/api/wallet", validateWalletResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.wallet } : result;
}
