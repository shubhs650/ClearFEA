// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared plumbing for calls to the API: JSON in and out, the API's own error text,
// and a distinct outcome for "not signed in" so the app can show the sign-in form.

import { validateErrorResponse, type Validation } from "@clearfea/spec";

export type ApiResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "signedOut"; problem: string }
  | { kind: "error"; problem: string };

const unreachable =
  "The API did not answer. Start it with `pnpm --filter @clearfea/api dev` and try again.";

export function apiRequest<T>(
  method: string,
  path: string,
  validate: ((value: unknown) => Validation<T>) | null,
  body?: unknown,
): Promise<ApiResult<T>> {
  return send(path, validate, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Sends a file as the raw request body, as the upload routes expect. */
export function apiUpload<T>(
  path: string,
  validate: (value: unknown) => Validation<T>,
  file: Blob,
): Promise<ApiResult<T>> {
  return send(path, validate, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
}

async function send<T>(
  path: string,
  validate: ((value: unknown) => Validation<T>) | null,
  init: RequestInit,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, credentials: "same-origin" });
  } catch {
    return { kind: "error", problem: unreachable };
  }
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = validateErrorResponse(json);
    const problem = error.ok ? error.value.error : `${unreachable} (HTTP ${response.status})`;
    return response.status === 401 ? { kind: "signedOut", problem } : { kind: "error", problem };
  }
  if (validate === null) return { kind: "ok", value: undefined as T };
  const checked = validate(json);
  if (!checked.ok) {
    return {
      kind: "error",
      problem: `The API answered in an unexpected shape: ${checked.errors.join(" ")}`,
    };
  }
  return { kind: "ok", value: checked.value };
}
