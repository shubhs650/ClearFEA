-- SPDX-License-Identifier: AGPL-3.0-or-later
-- The verification account's sign-in (M10.9, ADR-104): each refused token is a row, so the route
-- can refuse every attempt for an hour after ten wrong ones. Rows older than a day are deleted
-- by the route itself. The account is an ordinary users row, created at its first sign-in.

CREATE TABLE verification_failures (
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
