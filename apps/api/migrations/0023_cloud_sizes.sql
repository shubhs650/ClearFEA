-- SPDX-License-Identifier: AGPL-3.0-or-later
-- The cloud size list (M10.6, ADR-095 item 5, ADR-098): which machine sizes the live site runs
-- on AWS, and which of them are switched on. Null for a size the cloud does not have (small,
-- xlarge), which only `make dev`'s local worker simulates. On the live site (MACHINES=cloud) a
-- run may choose only a size that is on; locally every size stays offered, as before.
ALTER TABLE machine_sizes ADD COLUMN cloud TEXT CHECK (cloud IS NULL OR cloud IN ('on', 'off'));

-- Standard (4 vCPU, 16 GiB), the size every ADR-063 element limit was measured for, is on.
-- Large (8 vCPU, 32 GiB) is defined and off until the admin switches it on (DEPLOYMENT.md 7.3).
UPDATE machine_sizes SET cloud = 'on' WHERE name = 'medium';
UPDATE machine_sizes SET cloud = 'off' WHERE name = 'large';
