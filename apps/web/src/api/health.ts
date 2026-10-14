// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for GET /api/health. The response shape is checked against packages/spec.

import { validateHealthResponse } from "@clearfea/spec";

export type HealthState =
  | { kind: "checking" }
  | { kind: "ok" }
  | { kind: "degraded"; problems: string[] }
  | { kind: "unreachable"; problems: string[] };

const startApi =
  "Start it with `pnpm --filter @clearfea/api dev` and reload this page.";

export async function fetchHealth(signal?: AbortSignal): Promise<HealthState> {
  let response: Response;
  try {
    response = await fetch("/api/health", { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: "unreachable", problems: [`The API did not answer. ${startApi}`] };
  }

  const checked = validateHealthResponse(await response.json().catch(() => undefined));
  if (!checked.ok) {
    // The Vite proxy answers with an empty 5xx when nothing listens on port 8787.
    return {
      kind: "unreachable",
      problems: [`The API did not answer on port 8787 (HTTP ${response.status}). ${startApi}`],
    };
  }

  const body = checked.value;
  if (body.status === "ok") return { kind: "ok" };
  const problems = [body.database, body.storage].filter((value) => value !== "ok");
  return { kind: "degraded", problems };
}
