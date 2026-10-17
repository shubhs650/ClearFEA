// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for /api/wallet (M8.1, ADR-080). Shapes: packages/spec/schemas/wallet.schema.json.

import { validateWalletResponse, type WalletResponse } from "@clearfea/spec";
import { type ApiResult, apiRequest } from "./request";

/** The signed-in user's balance and ledger, newest entry first, and whether the wallet is informational. */
export async function fetchWallet(): Promise<ApiResult<WalletResponse>> {
  return apiRequest("GET", "/api/wallet", validateWalletResponse);
}
