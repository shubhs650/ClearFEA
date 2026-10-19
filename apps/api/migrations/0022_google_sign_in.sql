-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Google sign-in for the live closed beta (M10.3, ADR-095 item 3, ADR-097). Better Auth keeps its
-- users in `users` (a Google user's login is their email address), its sessions, linked Google
-- accounts and short-lived OAuth state in the three auth_ tables, and the admin's allowlist in
-- allowed_emails. Column names are mapped to Better Auth's fields in src/session/google.ts.
-- Booleans are 0 or 1 and times ISO 8601 UTC strings, as Better Auth writes them on SQLite.

ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN image TEXT;
ALTER TABLE users ADD COLUMN updated_at TEXT;
-- The seeded test users have no email; SQLite lets any number of rows share NULL.
CREATE UNIQUE INDEX users_email ON users (email);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX auth_sessions_user_id ON auth_sessions (user_id);

CREATE TABLE auth_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Google's own id for the account, and "google".
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  scope TEXT,
  -- Unused: there are no Better Auth passwords (the seeded test users keep users.password_hash).
  password TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX auth_accounts_user_id ON auth_accounts (user_id);

CREATE TABLE auth_verifications (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX auth_verifications_identifier ON auth_verifications (identifier);

-- Addresses the admin has invited, lower case. The admin's own address (ADMIN_EMAIL) is never
-- stored: it comes from the Worker's configuration.
CREATE TABLE allowed_emails (
  email TEXT PRIMARY KEY NOT NULL,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The play-money grant a user gets at their first Google sign-in, in micro-credits: the same
-- 100 credits the seeded test users get (ADR-080). A placeholder, like the other settings.
INSERT INTO settings (name, value) VALUES ('signup_grant_micro_credits', 100000000);
