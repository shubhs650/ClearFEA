// SPDX-License-Identifier: AGPL-3.0-or-later
// Sign in, check who is signed in, sign out (ADR-022). Shapes: packages/spec/schemas/session.schema.json.
// In "google" mode (M10.3, ADR-097) people sign in through Better Auth at /api/auth, and the
// password route here refuses; checking and ending the session work the same in both modes.

import { type SessionResponse, type SessionUser, type SignInOptions, validateLoginRequest } from "@clearfea/spec";
import { Hono } from "hono";
import { readBody } from "../body";
import { isAdminEmail } from "../db/allowlist";
import { findCredentials, getUser, type UserWithEmail } from "../db/users";
import {
  authMode,
  configurationProblem,
  endSession,
  type SessionEnv,
  SIGNED_OUT_MESSAGE,
  sessionUserId,
  startSession,
} from "../session";
import { googleAuth } from "../session/google";
import { verifyPassword } from "../session/password";

export const session = new Hono<SessionEnv>();

export const PASSWORD_OFF_MESSAGE =
  "Password sign-in is turned off on this site. Use Sign in with Google with the address you were invited with.";

// Checked against when the login is unknown, so a wrong login takes as long as a wrong password.
const DUMMY_HASH =
  "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function sessionUser(user: UserWithEmail, adminEmail: string | undefined): SessionUser {
  return { id: user.id, login: user.login, name: user.name, admin: isAdminEmail(user.email, adminEmail) };
}

session.get("/options", (c) => {
  return c.json({ signIn: authMode(c.env) === "google" ? "google" : "password" } satisfies SignInOptions);
});

session.post("/", async (c) => {
  const problem = configurationProblem(c.env);
  if (problem !== null) return c.json({ error: problem }, 503);
  if (authMode(c.env) === "google") return c.json({ error: PASSWORD_OFF_MESSAGE }, 403);
  const body = await readBody(c.req.raw, validateLoginRequest, "LoginRequest", "session.schema.json");
  if ("error" in body) return c.json({ error: body.error }, 400);

  const { login, password } = body.value;
  const found = await findCredentials(c.env.DB, login);
  const matches = await verifyPassword(password, found?.passwordHash ?? DUMMY_HASH);
  if (found === null || found.passwordHash === null || !matches) {
    return c.json({ error: "The login or password is wrong. Check both and try again." }, 401);
  }
  await startSession(c, c.env.SESSION_SECRET ?? "", found.user.id);
  return c.json({ user: sessionUser(found.user, c.env.ADMIN_EMAIL) } satisfies SessionResponse);
});

session.get("/", async (c) => {
  const problem = configurationProblem(c.env);
  if (problem !== null) return c.json({ error: problem }, 503);
  const userId = await sessionUserId(c);
  const user = userId === null ? null : await getUser(c.env.DB, userId);
  if (user === null) return c.json({ error: SIGNED_OUT_MESSAGE }, 401);
  return c.json({ user: sessionUser(user, c.env.ADMIN_EMAIL) } satisfies SessionResponse);
});

session.delete("/", async (c) => {
  if (authMode(c.env) === "google" && configurationProblem(c.env) === null) {
    // Ends the session row and clears Better Auth's cookies.
    const ended = await googleAuth(c.env).api.signOut({ headers: c.req.raw.headers, asResponse: true });
    const headers = new Headers();
    for (const cookie of ended.headers.getSetCookie()) headers.append("Set-Cookie", cookie);
    return new Response(null, { status: 204, headers });
  }
  endSession(c);
  return c.body(null, 204);
});
