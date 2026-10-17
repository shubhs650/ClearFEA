// SPDX-License-Identifier: AGPL-3.0-or-later
// Read-only share links of runs (M8.7, ADR-082). Functions used on behalf of the owner take the
// owner's id and filter on owner_id. resolveShareLink is the one lookup without a user id: the
// link's token is the credential, and it answers only the owner and run the token was made for,
// which the caller then reads through the owner-scoped functions. Only the token's hash is stored.

import type { ShareLinkView } from "@clearfea/spec";

/** The form of a token: 32 random bytes in base64url without padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A new random token. */
export function newShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** The stored form of a token: its SHA-256 in lower-case hex. */
export async function hashShareToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The run's active share link, or null when it has none or the run is not the user's. */
export async function getShareLink(db: D1Database, userId: string, runId: string): Promise<ShareLinkView | null> {
  const row = await db
    .prepare("SELECT created_at FROM share_links WHERE run_id = ? AND owner_id = ?")
    .bind(runId, userId)
    .first<{ created_at: string }>();
  return row === null ? null : { createdAt: row.created_at };
}

/**
 * Makes a share link for one of the user's succeeded runs with the token's hash, replacing the
 * run's earlier link, which stops working. The insert checks the run's owner and status in the
 * same statement; returns null when it is not the user's succeeded run.
 */
export async function createShareLink(
  db: D1Database,
  userId: string,
  runId: string,
  token: string,
): Promise<ShareLinkView | null> {
  const hash = await hashShareToken(token);
  const result = await db
    .prepare(
      `INSERT INTO share_links (run_id, owner_id, token_hash)
       SELECT id, owner_id, ? FROM runs WHERE id = ? AND owner_id = ? AND status = 'succeeded'
       ON CONFLICT (run_id) DO UPDATE SET token_hash = excluded.token_hash,
                                          created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(hash, runId, userId)
    .run();
  if (result.meta.changes !== 1) return null;
  return getShareLink(db, userId, runId);
}

/** Revokes the run's share link, if it has one; returns whether one was revoked. */
export async function revokeShareLink(db: D1Database, userId: string, runId: string): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM share_links WHERE run_id = ? AND owner_id = ?")
    .bind(runId, userId)
    .run();
  return result.meta.changes > 0;
}

/** The owner and run an active link's token opens, or null for a revoked, replaced or unknown token. */
export async function resolveShareLink(
  db: D1Database,
  token: string,
): Promise<{ ownerId: string; runId: string } | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const row = await db
    .prepare("SELECT owner_id, run_id FROM share_links WHERE token_hash = ?")
    .bind(await hashShareToken(token))
    .first<{ owner_id: string; run_id: string }>();
  return row === null ? null : { ownerId: row.owner_id, runId: row.run_id };
}
