// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for GET /api/health. The response shape is checked against packages/spec.

import { validateHealthResponse } from "@clearfea/spec";
import { accessExpired, isAccessRedirect } from "./request";

export type HealthState =
  | { kind: "checking" }
  | { kind: "ok" }
  | { kind: "degraded"; problems: string[] }
  | { kind: "unreachable"; problems: string[] };

// On the live site there is nothing for the user to start (M10.3); locally the API is `pnpm dev`.
const startApi = import.meta.env.DEV
  ? "Start it with `pnpm --filter @clearfea/api dev` and reload this page."
  : "Check your internet connection and reload this page in a minute.";
const noAnswer = import.meta.env.DEV ? "The API did not answer on port 8787" : "ClearFEA's server did not answer";

export async function fetchHealth(signal?: AbortSignal): Promise<HealthState> {
  let response: Response;
  try {
    response = await fetch("/api/health", { signal, redirect: "manual" });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { kind: "unreachable", problems: [`The API did not answer. ${startApi}`] };
  }
  if (isAccessRedirect(response)) return { kind: "unreachable", problems: [accessExpired] };

  const checked = validateHealthResponse(await response.json().catch(() => undefined));
  if (!checked.ok) {
    // The Vite proxy answers with an empty 5xx when nothing listens on port 8787.
    return {
      kind: "unreachable",
      problems: [`${noAnswer} (HTTP ${response.status}). ${startApi}`],
    };
  }

  const body = checked.value;
  if (body.status === "ok") return { kind: "ok" };
  const problems = [body.database, body.storage].filter((value) => value !== "ok");
  return { kind: "degraded", problems };
}
