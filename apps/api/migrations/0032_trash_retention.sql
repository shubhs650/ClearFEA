-- SPDX-License-Identifier: AGPL-3.0-or-later
-- The trash (M14.2, ADR-114, ADR-124): a project or folder in the trash is purged, with its
-- files, this many days after it went there, by the storage sweep. Change it with
-- `wrangler d1 execute`, like the other settings.
INSERT INTO settings (name, value) VALUES ('trash_retention_days', 30);
