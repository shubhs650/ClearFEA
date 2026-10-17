// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for /api/storage (M8.6, ADR-085). Shapes: packages/spec/schemas/storage.schema.json.

import { type StorageView, validateStorageResponse } from "@clearfea/spec";
import { type ApiResult, apiRequest } from "./request";

/** What the signed-in user stores, by kind, against the free allowance, and the runs holding raw output. */
export async function fetchStorage(): Promise<ApiResult<StorageView>> {
  const result = await apiRequest("GET", "/api/storage", validateStorageResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.storage } : result;
}
