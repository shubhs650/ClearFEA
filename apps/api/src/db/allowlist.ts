// SPDX-License-Identifier: AGPL-3.0-or-later
// Who may sign in on the live closed beta, and the admin's view of the users (M10.3, ADR-095
// item 3, ADR-097). Not owner-scoped, like `findCredentials`: sign-in runs before anyone is known,
// and the admin routes call these only after `requireAdmin` has checked the caller.

/** An address as it is stored and compared: trimmed and lower case. */
export function normalEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True when this is the admin's address. No admin is configured when `adminEmail` is unset. */
export function isAdminEmail(email: string | null, adminEmail: string | undefined): boolean {
  if (email === null || !adminEmail?.trim()) return false;
  return normalEmail(email) === normalEmail(adminEmail);
}

/** True when the address may sign in: the admin's, or one on the allowlist. */
export async function isAllowed(db: D1Database, email: string, adminEmail: string | undefined): Promise<boolean> {
  if (isAdminEmail(email, adminEmail)) return true;
  const row = await db.prepare("SELECT 1 AS found FROM allowed_emails WHERE email = ?").bind(normalEmail(email)).first();
  return row !== null;
}

export interface AllowedEmail {
  email: string;
  addedAt: string;
}

export async function listAllowed(db: D1Database): Promise<AllowedEmail[]> {
  const { results } = await db
    .prepare("SELECT email, added_at AS addedAt FROM allowed_emails ORDER BY email")
    .all<AllowedEmail>();
  return results;
}

/** Adds the address; adding one already there changes nothing. */
export async function addAllowed(db: D1Database, email: string): Promise<void> {
  await db.prepare("INSERT INTO allowed_emails (email) VALUES (?) ON CONFLICT (email) DO NOTHING").bind(normalEmail(email)).run();
}

/**
 * Removes the address and ends every session of the user who signs in with it, so they are
 * signed out at their next request. Their projects and runs stay. Returns false when the address
 * was not on the list.
 */
export async function removeAllowed(db: D1Database, email: string): Promise<boolean> {
  const address = normalEmail(email);
  const [removed] = await db.batch([
    db.prepare("DELETE FROM allowed_emails WHERE email = ?").bind(address),
    db.prepare("DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)").bind(address),
  ]);
  return (removed?.meta.changes ?? 0) > 0;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string | null;
  createdAt: string;
  /** When their latest session started, or null if they never signed in with Google. */
  lastSignIn: string | null;
}

/** Every user, newest first, with when they last signed in with Google. */
export async function listUsers(db: D1Database): Promise<UserSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.created_at AS createdAt,
              (SELECT MAX(s.created_at) FROM auth_sessions s WHERE s.user_id = u.id) AS lastSignIn
         FROM users u ORDER BY u.created_at DESC, u.id`,
    )
    .all<UserSummary>();
  return results;
}
