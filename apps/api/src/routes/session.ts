// SPDX-License-Identifier: AGPL-3.0-or-later
// Sign in, check who is signed in, sign out (ADR-022). Shapes: packages/spec/schemas/session.schema.json.

import { type SessionResponse, validateLoginRequest } from "@clearfea/spec";
import { Hono } from "hono";
import { readBody } from "../body";
import { findCredentials, getUser } from "../db/users";
import {
  endSession,
  NO_SECRET_MESSAGE,
  type SessionEnv,
  SIGNED_OUT_MESSAGE,
  sessionUserId,
  startSession,
} from "../session";
import { verifyPassword } from "../session/password";

export const session = new Hono<SessionEnv>();

// Checked against when the login is unknown, so a wrong login takes as long as a wrong password.
const DUMMY_HASH =
  "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

session.post("/", async (c) => {
  const secret = c.env.SESSION_SECRET;
  if (!secret) return c.json({ error: NO_SECRET_MESSAGE }, 503);
  const body = await readBody(c.req.raw, validateLoginRequest, "LoginRequest", "session.schema.json");
  if ("error" in body) return c.json({ error: body.error }, 400);

  const { login, password } = body.value;
  const found = await findCredentials(c.env.DB, login);
  const matches = await verifyPassword(password, found?.passwordHash ?? DUMMY_HASH);
  if (found === null || found.passwordHash === null || !matches) {
    return c.json({ error: "The login or password is wrong. Check both and try again." }, 401);
  }
  await startSession(c, secret, found.user.id);
  return c.json({ user: found.user } satisfies SessionResponse);
});

session.get("/", async (c) => {
  const secret = c.env.SESSION_SECRET;
  if (!secret) return c.json({ error: NO_SECRET_MESSAGE }, 503);
  const userId = await sessionUserId(c, secret);
  const user = userId === null ? null : await getUser(c.env.DB, userId);
  if (user === null) return c.json({ error: SIGNED_OUT_MESSAGE }, 401);
  return c.json({ user } satisfies SessionResponse);
});

session.delete("/", (c) => {
  endSession(c);
  return c.body(null, 204);
});
