-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Phase 0 login (ADR-022): each seeded test user has a password hash.
-- Format: pbkdf2-sha256$<iterations>$<salt, base64>$<hash, base64>.
-- Null means the user cannot sign in with a password.

ALTER TABLE users ADD COLUMN password_hash TEXT;
