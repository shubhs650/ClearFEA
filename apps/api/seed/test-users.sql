-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Two test users for local development (ADR-022). Applied to the local D1 only, by
-- `pnpm --filter @clearfea/api db:seed` (part of `pnpm --filter @clearfea/api dev`).
-- Safe to run again: it resets these two users' names and passwords.
-- Passwords (local test accounts only): alice / alice-local, bob / bob-local.
-- Hashes made with apps/api/scripts/hash-password.mjs. One statement per line.

INSERT INTO users (id, login, name, password_hash) VALUES ('00000000-0000-4000-8000-00000000a11c', 'alice', 'Alice (test user)', 'pbkdf2-sha256$100000$4HnxySTjtpX2f3CFeo39ig==$A+WLsD4tqbRIABR3nqPHxFn32jQhu/n2zZg6eb2VIiM=') ON CONFLICT (id) DO UPDATE SET login = excluded.login, name = excluded.name, password_hash = excluded.password_hash;
INSERT INTO users (id, login, name, password_hash) VALUES ('00000000-0000-4000-8000-000000000b0b', 'bob', 'Bob (test user)', 'pbkdf2-sha256$100000$4eK9ECrl/27mFaYlDvA3LQ==$IwY5mb2cKoKYiDdvflbBYQmJxkZ+m7MUY6d19NHcx3E=') ON CONFLICT (id) DO UPDATE SET login = excluded.login, name = excluded.name, password_hash = excluded.password_hash;
