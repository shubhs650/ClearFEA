// SPDX-License-Identifier: AGPL-3.0-or-later
// The session layer (docs/ARCHITECTURE.md section 8, ADR-022). Routes only see
// `requireUser`, which puts the signed-in user's id in `c.var.userId`, and the
// start and end functions used by the login routes. Real authentication replaces
// this module in Phase 1 without touching the routes that use it.

import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { getUser } from "../db/users";
import type { Env } from "../env";
import { issueToken, readToken } from "./token";

export type SessionVariables = { userId: string };
export type SessionEnv = { Bindings: Env; Variables: SessionVariables };

export const SESSION_COOKIE = "clearfea_session";
/** How long a sign-in lasts, in seconds. */
export const SESSION_LIFETIME = 7 * 24 * 60 * 60;

export const NO_SECRET_MESSAGE =
  "The API has no session secret configured. Add a SESSION_SECRET line to apps/api/.dev.vars (see .dev.vars.example) and restart the API.";
export const SIGNED_OUT_MESSAGE = "You are not signed in, or your sign-in has expired. Sign in again.";

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

/** The signed-in user's id, or null. Does not check that the user still exists. */
export async function sessionUserId(c: Context, secret: string): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  return token === undefined ? null : readToken(secret, token, now());
}

/**
 * Refuses the request unless a valid session cookie names a user who still exists
 * (a wiped local database leaves old cookies behind), then sets `c.var.userId`.
 */
export const requireUser: MiddlewareHandler<SessionEnv> = async (c, next) => {
  const secret = c.env.SESSION_SECRET;
  if (!secret) return c.json({ error: NO_SECRET_MESSAGE }, 503);
  const userId = await sessionUserId(c, secret);
  if (userId === null || (await getUser(c.env.DB, userId)) === null) {
    return c.json({ error: SIGNED_OUT_MESSAGE }, 401);
  }
  c.set("userId", userId);
  await next();
};
