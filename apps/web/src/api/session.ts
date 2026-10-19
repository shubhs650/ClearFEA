// SPDX-License-Identifier: AGPL-3.0-or-later
// Client for /api/session (ADR-022) and the start of Google sign-in (M10.3, ADR-097).
// Shapes: packages/spec/schemas/session.schema.json.

import { type SessionUser, type SignInOptions, validateSessionResponse, validateSignInOptions } from "@clearfea/spec";
import { WORKBENCH_PATH } from "../pages";
import { type ApiResult, apiRequest } from "./request";

export async function fetchSession(): Promise<ApiResult<SessionUser>> {
  const result = await apiRequest("GET", "/api/session", validateSessionResponse);
  return result.kind === "ok" ? { kind: "ok", value: result.value.user } : result;
}

export async function signIn(login: string, password: string): Promise<ApiResult<SessionUser>> {
  const result = await apiRequest("POST", "/api/session", validateSessionResponse, {
    login,
    password,
  });
  return result.kind === "ok" ? { kind: "ok", value: result.value.user } : result;
}

export function signOut(): Promise<ApiResult<undefined>> {
  return apiRequest<undefined>("DELETE", "/api/session", null);
}

/** How this site signs people in: the local password form, or Google. */
export function fetchSignInOptions(): Promise<ApiResult<SignInOptions>> {
  return apiRequest("GET", "/api/session/options", validateSignInOptions);
}

/**
 * Starts Google sign-in: the API answers with Google's address, and the browser goes there.
 * Google sends it back to the workbench, signed in, or with `?error=<code>` when refused.
 */
export async function startGoogleSignIn(): Promise<ApiResult<undefined>> {
  const result = await apiRequest("POST", "/api/auth/sign-in/social", validateGoogleStart, {
    provider: "google",
    callbackURL: WORKBENCH_PATH,
    errorCallbackURL: WORKBENCH_PATH,
  });
  if (result.kind !== "ok") return result;
  window.location.assign(result.value.url);
  return { kind: "ok", value: undefined };
}

/** Better Auth's own answer, not a ClearFEA shape: only the address to go to is read. */
function validateGoogleStart(value: unknown) {
  const url = (value as { url?: unknown } | null)?.url;
  return typeof url === "string" && url.startsWith("https://accounts.google.com/")
    ? { ok: true as const, value: { url } }
    : { ok: false as const, errors: ["The answer has no Google sign-in address."] };
}

/** What a refused or failed Google sign-in means, from the `error` code Google or the API put in the address. */
export function googleErrorMessage(code: string): string {
  switch (code) {
    case "NOT_INVITED":
      return "This Google account is not invited to the ClearFEA closed beta. Ask the person who invited you to add this exact address, or sign in with the account they invited.";
    case "access_denied":
      return "Google sign-in was cancelled. Sign in again when you are ready.";
    default: {
      // The code comes from the address bar, so only a plain code is repeated back.
      const shown = /^[A-Za-z0-9_]{1,40}$/.test(code) ? ` (${code})` : "";
      return `Google sign-in did not finish${shown}. Try again; if it keeps happening, tell the person who invited you.`;
    }
  }
}
