-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Two test users for local development (ADR-022). Applied to the local D1 only, by
-- `pnpm --filter @clearfea/api db:seed` (part of `pnpm --filter @clearfea/api dev`).
-- Safe to run again: it resets these two users' names and passwords.
-- Passwords (local test accounts only): alice / alice-local, bob / bob-local.
-- Their addresses use the reserved .test domain; .dev.vars.example makes alice the admin (M10.3).
-- Hashes made with apps/api/scripts/hash-password.mjs. One statement per line.
-- Each user gets one play-money grant of 100 credits (100,000,000 micro-credits, M8.1, ADR-080),
-- added once: running the seed again leaves the ledger as it is.

INSERT INTO users (id, login, name, email, password_hash) VALUES ('00000000-0000-4000-8000-00000000a11c', 'alice', 'Alice (test user)', 'alice@clearfea.test', 'pbkdf2-sha256$100000$4HnxySTjtpX2f3CFeo39ig==$A+WLsD4tqbRIABR3nqPHxFn32jQhu/n2zZg6eb2VIiM=') ON CONFLICT (id) DO UPDATE SET login = excluded.login, name = excluded.name, email = excluded.email, password_hash = excluded.password_hash;
INSERT INTO users (id, login, name, email, password_hash) VALUES ('00000000-0000-4000-8000-000000000b0b', 'bob', 'Bob (test user)', 'bob@clearfea.test', 'pbkdf2-sha256$100000$4eK9ECrl/27mFaYlDvA3LQ==$IwY5mb2cKoKYiDdvflbBYQmJxkZ+m7MUY6d19NHcx3E=') ON CONFLICT (id) DO UPDATE SET login = excluded.login, name = excluded.name, email = excluded.email, password_hash = excluded.password_hash;
INSERT INTO ledger_entries (owner_id, amount, balance, reason) SELECT '00000000-0000-4000-8000-00000000a11c', 100000000, COALESCE((SELECT balance FROM ledger_entries WHERE owner_id = '00000000-0000-4000-8000-00000000a11c' ORDER BY seq DESC LIMIT 1), 0) + 100000000, 'grant' WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE owner_id = '00000000-0000-4000-8000-00000000a11c' AND reason = 'grant');
INSERT INTO ledger_entries (owner_id, amount, balance, reason) SELECT '00000000-0000-4000-8000-000000000b0b', 100000000, COALESCE((SELECT balance FROM ledger_entries WHERE owner_id = '00000000-0000-4000-8000-000000000b0b' ORDER BY seq DESC LIMIT 1), 0) + 100000000, 'grant' WHERE NOT EXISTS (SELECT 1 FROM ledger_entries WHERE owner_id = '00000000-0000-4000-8000-000000000b0b' AND reason = 'grant');
