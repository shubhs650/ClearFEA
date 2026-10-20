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
  let response: Response;
  try {
    response = await fetch("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ provider: "google", callbackURL: WORKBENCH_PATH, errorCallbackURL: WORKBENCH_PATH }),
    });
  } catch {
    return { kind: "error", problem: "ClearFEA's server did not answer. Check your internet connection and try again in a minute." };
  }
  const text = await response.text().catch(() => "");
  if (!response.ok) return { kind: "error", problem: googleStartRefused(response.status, text) };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const start = validateGoogleStart(body);
  if (!start.ok) return { kind: "error", problem: `The sign-in answer was not understood: ${start.errors.join(" ")}` };
  window.location.assign(start.value.url);
  return { kind: "ok", value: undefined };
}

/**
 * Why the start of Google sign-in was refused, from the answer's status and text. Better Auth
 * answers JSON with a code, for example when the browser did not say which site the request came
 * from; anything else (such as Cloudflare's "error code: 1010") is shown as it came, shortened,
 * so the person can pass it on.
 */
export function googleStartRefused(status: number, text: string): string {
  let code = "";
  let message = "";
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON: an HTML or plain-text page, shown as text.
  }
  if (typeof parsed === "object" && parsed !== null) {
    const fields = parsed as { code?: unknown; message?: unknown; error?: unknown };
    code = typeof fields.code === "string" ? fields.code : "";
    message = typeof fields.message === "string" ? fields.message : typeof fields.error === "string" ? fields.error : "";
  } else {
    message = String(parsed).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  }
  if (code === "MISSING_OR_NULL_ORIGIN" || code === "INVALID_ORIGIN") {
    return `Your browser did not say that this sign-in came from ${window.location.origin}, so it was refused (HTTP ${status}, ${code}). Open ${window.location.origin}/app by typing it in the address bar, or try a private window with extensions turned off.`;
  }
  const detail = [code, message].filter((part) => part !== "").join(": ");
  return `Google sign-in could not start: the server answered HTTP ${status}${detail ? ` (${detail})` : ""}. Try again in a minute; if it keeps happening, send this message to the person who invited you.`;
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
