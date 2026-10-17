// SPDX-License-Identifier: AGPL-3.0-or-later
// The signed-in user's wallet: balance, ledger and what each charge paid for (M8.1, ADR-080).
// Shapes: packages/spec/schemas/wallet.schema.json.

import type { WalletResponse } from "@clearfea/spec";
import { Hono } from "hono";
import { walletOf } from "../billing/ledger";
import { requireUser, type SessionEnv } from "../session";

export const wallet = new Hono<SessionEnv>();

wallet.use("*", requireUser);

wallet.get("/", async (c) => {
  return c.json({ wallet: await walletOf(c.env.DB, c.var.userId) } satisfies WalletResponse);
});
