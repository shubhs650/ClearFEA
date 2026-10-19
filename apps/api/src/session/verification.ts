// SPDX-License-Identifier: AGPL-3.0-or-later
// The verification account (M10.9, ADR-095 item 11, ADR-104): the live checks sign in with a secret
// token instead of a Google account. Off unless VERIFY_TOKEN is set. The token only ever signs in
// one dedicated account, which has no email address, is never on the allowlist and never the
// admin, and is held to the same wallet, machine sizes and caps as everyone. Its session is a
// cookie of its own, signed with the token itself, so changing or removing the token ends it.

import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { grantStatement } from "../billing/ledger";
import type { Env } from "../env";
import { issueToken, readToken } from "./token";

export const VERIFICATION_USER_ID = "00000000-0000-4000-8000-00000000c4ec";
export const VERIFICATION_LOGIN = "verification";
export const VERIFICATION_COOKIE = "clearfea_verification";
/** A day: long enough for the four-hour limit runs, short enough not to linger. */
export const VERIFICATION_LIFETIME = 24 * 60 * 60;
/** A shorter token is refused as too easy to guess. */
export const MIN_TOKEN_LENGTH = 32;
/** After this many wrong tokens in an hour, every attempt is refused until the hour has passed. */
export const MAX_FAILURES_PER_HOUR = 10;

function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** The configured token, or null when the verification sign-in is off or the token too short. */
export function verificationToken(env: Env): string | null {
  const token = env.VERIFY_TOKEN?.trim() ?? "";
  return token.length >= MIN_TOKEN_LENGTH ? token : null;
}

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

/** Compares in constant time; hashing first makes the lengths equal. */
export async function tokenMatches(given: string, wanted: string): Promise<boolean> {
  return crypto.subtle.timingSafeEqual(await digest(given), await digest(wanted));
}

export async function recentFailures(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM verification_failures WHERE at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')")
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function recordFailure(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM verification_failures WHERE at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')"),
    db.prepare("INSERT INTO verification_failures DEFAULT VALUES"),
  ]);
}

/** Creates the verification account and its play-money grant the first time; idempotent. */
export async function ensureVerificationUser(db: D1Database): Promise<void> {
  await db.batch([
    db
      .prepare("INSERT INTO users (id, login, name) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING")
      .bind(VERIFICATION_USER_ID, VERIFICATION_LOGIN, "Verification account (live checks)"),
    grantStatement(db, VERIFICATION_USER_ID),
  ]);
}

export async function startVerificationSession(c: Context, token: string): Promise<void> {
  const cookie = await issueToken(token, VERIFICATION_USER_ID, now() + VERIFICATION_LIFETIME);
  setCookie(c, VERIFICATION_COOKIE, cookie, {
    path: "/",
    httpOnly: true,
    sameSite: "Strict",
    secure: new URL(c.req.url).protocol === "https:",
    maxAge: VERIFICATION_LIFETIME,
  });
}

/** The verification account's id when the request carries its valid cookie, else null. */
export async function verificationUserId(c: Context): Promise<string | null> {
  const token = verificationToken(c.env as Env);
  const cookie = getCookie(c, VERIFICATION_COOKIE);
  if (token === null || cookie === undefined) return null;
  const userId = await readToken(token, cookie, now());
  return userId === VERIFICATION_USER_ID ? userId : null;
}
