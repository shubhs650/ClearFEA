// SPDX-License-Identifier: AGPL-3.0-or-later
// The session layer (docs/ARCHITECTURE.md section 8, ADR-022). Routes only see
// `requireUser`, which puts the signed-in user's id in `c.var.userId`, and the
// start and end functions used by the login routes. Two ways in (M10.3, ADR-097):
// "local", the seeded password logins with a signed cookie, and "google", Better Auth
// sessions on the live site (google.ts). AUTH_MODE picks one; the routes are the same.

import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { getUser } from "../db/users";
import type { Env } from "../env";
import { googleAuth, googleSettings } from "./google";
import { issueToken, readToken } from "./token";

export type SessionVariables = { userId: string };
export type SessionEnv = { Bindings: Env; Variables: SessionVariables };

export const SESSION_COOKIE = "clearfea_session";
/** How long a sign-in lasts, in seconds. */
export const SESSION_LIFETIME = 7 * 24 * 60 * 60;

export const NO_SECRET_MESSAGE =
  "The API has no session secret configured. Add a SESSION_SECRET line to apps/api/.dev.vars (see .dev.vars.example) and restart the API.";
export const SIGNED_OUT_MESSAGE = "You are not signed in, or your sign-in has expired. Sign in again.";

export type AuthMode = "local" | "google";

/** The configured sign-in mode, or null for a value that is neither (the API then refuses). */
export function authMode(env: Env): AuthMode | null {
  const mode = env.AUTH_MODE?.trim() || "local";
  return mode === "local" || mode === "google" ? mode : null;
}

/**
 * Why sign-in cannot work as configured, or null when it can: an unknown AUTH_MODE, or a
 * missing secret for the mode in use.
 */
export function configurationProblem(env: Env): string | null {
  const mode = authMode(env);
  if (mode === null) {
    return `AUTH_MODE is "${env.AUTH_MODE}"; it must be "local" or "google". Fix the API's configuration and deploy again.`;
  }
  if (mode === "local") return env.SESSION_SECRET ? null : NO_SECRET_MESSAGE;
  const settings = googleSettings(env);
  return settings.ok
    ? null
    : `Google sign-in is not set up: the API has no ${settings.missing.join(", ")}. Add them as GitHub secrets (docs/DEPLOYMENT.md section 5) and deploy again.`;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Signs the user in by setting the session cookie. */
export async function startSession(c: Context, secret: string, userId: string): Promise<void> {
  const token = await issueToken(secret, userId, now() + SESSION_LIFETIME);
  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    // Browsers accept Secure cookies on http://localhost, but not every one does; set it whenever the API is reached over HTTPS.
    secure: new URL(c.req.url).protocol === "https:",
    maxAge: SESSION_LIFETIME,
  });
}

export function endSession(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/**
 * The signed-in user's id, or null. Call only when `configurationProblem` is null. A local
 * session does not check that the user still exists; a Google session is a database row.
 */
export async function sessionUserId(c: Context<SessionEnv>): Promise<string | null> {
  if (authMode(c.env) === "google") {
    const found = await googleAuth(c.env).api.getSession({ headers: c.req.raw.headers });
    return found?.user.id ?? null;
  }
  const token = getCookie(c, SESSION_COOKIE);
  return token === undefined ? null : readToken(c.env.SESSION_SECRET ?? "", token, now());
}

/**
 * Refuses the request unless the session names a user who still exists (a wiped local
 * database leaves old cookies behind), then sets `c.var.userId`.
 */
export const requireUser: MiddlewareHandler<SessionEnv> = async (c, next) => {
  const problem = configurationProblem(c.env);
  if (problem !== null) return c.json({ error: problem }, 503);
  const userId = await sessionUserId(c);
  if (userId === null || (await getUser(c.env.DB, userId)) === null) {
    return c.json({ error: SIGNED_OUT_MESSAGE }, 401);
  }
  c.set("userId", userId);
  await next();
};
