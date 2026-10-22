-- SPDX-License-Identifier: AGPL-3.0-or-later
-- The dashboard's Costs tab (M13.3, ADR-113, ADR-128): what the closed beta costs each month
-- whatever it is used for, in US cents, set by the admin on the Settings tab. Shown only to the
-- admin beside the month's machine time; users' wallets show usage only (ADR-106 item 6).
INSERT INTO settings (name, value) VALUES
  -- The solver host: a Contabo Cloud VPS 8 paid monthly in advance, about $17 (ADR-106 item 1).
  ('solver_host_monthly_cents', 1700),
  -- Cloudflare: Workers Paid, with D1 and R2 inside the included amounts (docs/ARCHITECTURE.md).
  ('platform_monthly_cents', 500);
