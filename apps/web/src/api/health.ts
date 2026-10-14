// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for GET /api/health. The response shape is checked by hand here until
// packages/spec holds the shared schemas (M0.6); then this check moves to the schema.

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

  const body: unknown = await response.json().catch(() => undefined);
  if (!isHealthBody(body)) {
    // The Vite proxy answers with an empty 5xx when nothing listens on port 8787.
    return {
      kind: "unreachable",
      problems: [`The API did not answer on port 8787 (HTTP ${response.status}). ${startApi}`],
    };
  }

  if (body.status === "ok") return { kind: "ok" };
  const problems = [body.database, body.storage].filter((value) => value !== "ok");
  return { kind: "degraded", problems };
}

interface HealthBody {
  status: "ok" | "degraded";
  database: string;
  storage: string;
}

function isHealthBody(value: unknown): value is HealthBody {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.status === "ok" || record.status === "degraded") &&
    typeof record.database === "string" &&
    typeof record.storage === "string"
  );
}
