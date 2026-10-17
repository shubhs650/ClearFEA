-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Read-only share links of runs (M8.7, ADR-082; docs/ARCHITECTURE.md section 10). A run has at
-- most one active link. The link's token is random and shown to the owner once; only its SHA-256
-- hash is stored, so the database alone cannot open a shared run. Revoking a link deletes its row,
-- and making a new link replaces the run's earlier one.

CREATE TABLE share_links (
  run_id TEXT PRIMARY KEY NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Lower-case hex SHA-256 of the token.
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX share_links_owner_id ON share_links (owner_id);
