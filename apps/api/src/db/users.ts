// SPDX-License-Identifier: AGPL-3.0-or-later
// Users (docs/ARCHITECTURE.md section 4). `findCredentials` is the one function that
// looks a user up without knowing who is acting: it is how the login route finds out.

export interface User {
  id: string;
  login: string;
  name: string;
}

export async function getUser(db: D1Database, userId: string): Promise<User | null> {
  return db
    .prepare("SELECT id, login, name FROM users WHERE id = ?")
    .bind(userId)
    .first<User>();
}

/** The user with this login and their password hash, for checking a sign-in. */
export async function findCredentials(
  db: D1Database,
  login: string,
): Promise<{ user: User; passwordHash: string | null } | null> {
  const row = await db
    .prepare("SELECT id, login, name, password_hash FROM users WHERE login = ?")
    .bind(login)
    .first<User & { password_hash: string | null }>();
  if (row === null) return null;
  return { user: { id: row.id, login: row.login, name: row.name }, passwordHash: row.password_hash };
}
