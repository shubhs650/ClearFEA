// SPDX-License-Identifier: AGPL-3.0-or-later
// Users (docs/ARCHITECTURE.md section 4). `findCredentials` is the one function that
// looks a user up without knowing who is acting: it is how the login route finds out.

export interface User {
  id: string;
  login: string;
  name: string;
}

/** A user and their email address (null for the seeded test users unless the seed gives one). */
export type UserWithEmail = User & { email: string | null };

export async function getUser(db: D1Database, userId: string): Promise<UserWithEmail | null> {
  return db
    .prepare("SELECT id, login, name, email FROM users WHERE id = ?")
    .bind(userId)
    .first<UserWithEmail>();
}

/** The user with this login and their password hash, for checking a sign-in. */
export async function findCredentials(
  db: D1Database,
  login: string,
): Promise<{ user: UserWithEmail; passwordHash: string | null } | null> {
  const row = await db
    .prepare("SELECT id, login, name, email, password_hash FROM users WHERE login = ?")
    .bind(login)
    .first<UserWithEmail & { password_hash: string | null }>();
  if (row === null) return null;
  return {
    user: { id: row.id, login: row.login, name: row.name, email: row.email },
    passwordHash: row.password_hash,
  };
}
