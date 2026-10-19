// SPDX-License-Identifier: AGPL-3.0-or-later
// The admin page's routes (M10.3, ADR-097): the allowlist of Google addresses that may sign in,
// and the users. Only the admin (ADMIN_EMAIL) reaches them; to anyone else they answer as if
// they did not exist. Shapes: packages/spec/schemas/admin.schema.json.

import { type AdminResponse, validateAddAllowedRequest } from "@clearfea/spec";
import { Hono, type MiddlewareHandler } from "hono";
import { readBody } from "../body";
import { addAllowed, isAdminEmail, listAllowed, listUsers, normalEmail, removeAllowed } from "../db/allowlist";
import { getUser } from "../db/users";
import { requireUser, type SessionEnv } from "../session";

export const admin = new Hono<SessionEnv>();

const NOT_FOUND = "There is no such page.";

/** Refuses everyone but the admin, with the same 404 an unknown address gets. */
const requireAdmin: MiddlewareHandler<SessionEnv> = async (c, next) => {
  const user = await getUser(c.env.DB, c.var.userId);
  if (user === null || !isAdminEmail(user.email, c.env.ADMIN_EMAIL)) return c.json({ error: NOT_FOUND }, 404);
  await next();
};

admin.use("*", requireUser, requireAdmin);

async function view(db: D1Database, adminEmail: string): Promise<AdminResponse> {
  const [allowed, users] = await Promise.all([listAllowed(db), listUsers(db)]);
  const invited = new Set(allowed.map((a) => a.email));
  return {
    adminEmail: normalEmail(adminEmail),
    allowed,
    users: users.map((u) => ({
      ...u,
      allowed: u.email !== null && (invited.has(normalEmail(u.email)) || isAdminEmail(u.email, adminEmail)),
    })),
  };
}

admin.get("/", async (c) => c.json(await view(c.env.DB, c.env.ADMIN_EMAIL ?? "")));

admin.post("/allowed", async (c) => {
  const body = await readBody(c.req.raw, validateAddAllowedRequest, "AddAllowedRequest", "admin.schema.json");
  if ("error" in body) {
    return c.json({ error: "Type one email address, such as colleague@gmail.com, and try again." }, 400);
  }
  if (isAdminEmail(body.value.email, c.env.ADMIN_EMAIL)) {
    return c.json({ error: "That is the admin's own address, which can always sign in. Nothing was added." }, 400);
  }
  await addAllowed(c.env.DB, body.value.email);
  return c.json(await view(c.env.DB, c.env.ADMIN_EMAIL ?? ""));
});

admin.delete("/allowed/:email", async (c) => {
  const removed = await removeAllowed(c.env.DB, c.req.param("email"));
  if (!removed) return c.json({ error: "That address is not on the list. Reload the admin page." }, 404);
  return c.json(await view(c.env.DB, c.env.ADMIN_EMAIL ?? ""));
});
