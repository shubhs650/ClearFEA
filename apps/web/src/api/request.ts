// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared plumbing for calls to the API: JSON in and out, the API's own error text,
// and a distinct outcome for "not signed in" so the app can show the sign-in form.

import { validateErrorResponse, type Validation } from "@clearfea/spec";

export type ApiResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "signedOut"; problem: string }
  | { kind: "error"; problem: string };

// On the live site there is nothing for the user to start (M10.3); locally the API is `pnpm dev`.
const unreachable = import.meta.env.DEV
  ? "The API did not answer. Start it with `pnpm --filter @clearfea/api dev` and try again."
  : "ClearFEA's server did not answer. Check your internet connection and try again in a minute.";

/**
 * The live site is behind Cloudflare Access (ADR-111). Once its sign-in expires, Access answers
 * every request with a redirect to its own sign-in page. The API never redirects, so requests do
 * not follow redirects, and one that comes back is that expired sign-in.
 */
export const accessExpired =
  "Your Cloudflare Access sign-in for this site has expired. Reload the page to sign in again; your work is saved.";

export function isAccessRedirect(response: Response): boolean {
  return response.type === "opaqueredirect";
}

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
  method = "POST",
): Promise<ApiResult<T>> {
  return send(path, validate, {
    method,
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
    response = await fetch(path, { ...init, credentials: "same-origin", redirect: "manual" });
  } catch {
    return { kind: "error", problem: unreachable };
  }
  if (isAccessRedirect(response)) return { kind: "error", problem: accessExpired };
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

/** Fetches a binary file, such as a display mesh. Errors come back as the API's JSON text. */
export async function apiBinary(path: string): Promise<ApiResult<ArrayBuffer>> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", redirect: "manual" });
  } catch {
    return { kind: "error", problem: unreachable };
  }
  if (isAccessRedirect(response)) return { kind: "error", problem: accessExpired };
  if (!response.ok) {
    const json: unknown = await response.json().catch(() => undefined);
    const error = validateErrorResponse(json);
    const problem = error.ok ? error.value.error : `${unreachable} (HTTP ${response.status})`;
    return response.status === 401 ? { kind: "signedOut", problem } : { kind: "error", problem };
  }
  return { kind: "ok", value: await response.arrayBuffer() };
}

/** A file the API sends as an attachment, with the name it gives in Content-Disposition. */
export interface Download {
  blob: Blob;
  name: string;
}

/** The file name of a Content-Disposition header, or the fallback. */
export function attachmentName(header: string | null, fallback: string): string {
  const match = header === null ? null : /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? fallback;
}

/** Fetches a file to save, such as the admin's exports (M13.4). Errors come back as the API's JSON text. */
export async function apiDownload(path: string, fallbackName: string): Promise<ApiResult<Download>> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", redirect: "manual" });
  } catch {
    return { kind: "error", problem: unreachable };
  }
  if (isAccessRedirect(response)) return { kind: "error", problem: accessExpired };
  if (!response.ok) {
    const json: unknown = await response.json().catch(() => undefined);
    const error = validateErrorResponse(json);
    const problem = error.ok ? error.value.error : `${unreachable} (HTTP ${response.status})`;
    return response.status === 401 ? { kind: "signedOut", problem } : { kind: "error", problem };
  }
  const name = attachmentName(response.headers.get("Content-Disposition"), fallbackName);
  return { kind: "ok", value: { blob: await response.blob(), name } };
}
