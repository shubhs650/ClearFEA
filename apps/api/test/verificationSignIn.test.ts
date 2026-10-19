// SPDX-License-Identifier: AGPL-3.0-or-later
// The verification account's sign-in (M10.9, ADR-104): off without VERIFY_TOKEN, only the one
// account, never the admin, refused after ten wrong tokens in an hour, and ended by sign-out or
// by changing the token. Run in "google" mode, as on the live site, and in "local" mode.
import { validateSessionResponse } from "@clearfea/spec";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { MAX_FAILURES_PER_HOUR, VERIFICATION_USER_ID, tokenMatches } from "../src/session/verification";

const TOKEN = "test-verify-token-0123456789abcdef0123456789abcdef";
const GOOGLE: Env = {
  ...env,
  AUTH_MODE: "google",
  BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef0123456789",
  BETTER_AUTH_URL: "http://localhost",
  GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  ADMIN_EMAIL: "admin.person@gmail.com",
  VERIFY_TOKEN: TOKEN,
};

function call(
  method: string,
  path: string,
  options: { config?: Env; token?: string; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers.Authorization = `Bearer ${options.token}`;
  if (options.cookie) headers.Cookie = options.cookie;
  return Promise.resolve(app.fetch(new Request(`http://localhost${path}`, { method, headers }), options.config ?? GOOGLE));
}

function cookieOf(response: Response): string {
  const header = response.headers.getSetCookie().find((c) => c.startsWith("clearfea_verification=")) ?? "";
  return header.split(";")[0] ?? "";
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM verification_failures"),
    env.DB.prepare("DELETE FROM ledger_entries"),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(VERIFICATION_USER_ID),
  ]);
});

describe("verification sign-in", () => {
  it("does not exist without a token, or with one too short to be safe", async () => {
    for (const VERIFY_TOKEN of [undefined, "", "short-token"]) {
      const response = await call("POST", "/api/session/verification", { config: { ...GOOGLE, VERIFY_TOKEN }, token: "short-token" });
      expect(response.status).toBe(404);
    }
    const users = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").bind(VERIFICATION_USER_ID).first<{ n: number }>();
    expect(users?.n).toBe(0);
  });

  it("signs in the one verification account, not the admin, with the usual grant once", async () => {
    for (const config of [GOOGLE, { ...env, VERIFY_TOKEN: TOKEN }]) {
      const response = await call("POST", "/api/session/verification", { config, token: TOKEN });
      expect(response.status).toBe(200);
      const body = validateSessionResponse(await response.json());
      if (!body.ok) throw new Error(body.errors.join(" "));
      expect(body.value.user).toEqual({
        id: VERIFICATION_USER_ID,
        login: "verification",
        name: "Verification account (live checks)",
        admin: false,
      });

      const cookie = cookieOf(response);
      expect(response.headers.getSetCookie().join()).toMatch(/HttpOnly/);
      const session = await call("GET", "/api/session", { config, cookie });
      expect(session.status).toBe(200);
      expect((await call("GET", "/api/wallet", { config, cookie })).status).toBe(200);
      // Never the admin: the admin routes answer as if they did not exist.
      expect((await call("GET", "/api/admin", { config, cookie })).status).toBe(404);
    }
    const ledger = await env.DB.prepare("SELECT amount, reason FROM ledger_entries WHERE owner_id = ?").bind(VERIFICATION_USER_ID).all();
    expect(ledger.results).toEqual([{ amount: 100_000_000, reason: "grant" }]);
    const row = await env.DB.prepare("SELECT email, password_hash FROM users WHERE id = ?").bind(VERIFICATION_USER_ID).first();
    expect(row).toEqual({ email: null, password_hash: null });
  });

  it("refuses a wrong or missing token, and every attempt after ten wrong ones in an hour", async () => {
    expect((await call("POST", "/api/session/verification")).status).toBe(401);
    for (let i = 1; i < MAX_FAILURES_PER_HOUR; i++) {
      expect((await call("POST", "/api/session/verification", { token: `${TOKEN}x` })).status).toBe(401);
    }
    const locked = await call("POST", "/api/session/verification", { token: TOKEN });
    expect(locked.status).toBe(429);
    expect(cookieOf(locked)).toBe("");
  });

  it("is ended by signing out and by changing the token", async () => {
    const cookie = cookieOf(await call("POST", "/api/session/verification", { token: TOKEN }));
    const rotated = { ...GOOGLE, VERIFY_TOKEN: `${TOKEN}-rotated` };
    expect((await call("GET", "/api/session", { config: rotated, cookie })).status).toBe(401);
    expect((await call("GET", "/api/session", { config: { ...GOOGLE, VERIFY_TOKEN: undefined }, cookie })).status).toBe(401);

    const out = await call("DELETE", "/api/session", { cookie });
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie().join()).toMatch(/clearfea_verification=;.*Max-Age=0/);
  });

  it("does not accept a forged cookie for another user", async () => {
    const cookie = cookieOf(await call("POST", "/api/session/verification", { token: TOKEN }));
    const forged = cookie.replace(VERIFICATION_USER_ID, "00000000-0000-4000-8000-00000000a11c");
    expect((await call("GET", "/api/session", { cookie: forged })).status).toBe(401);
  });

  it("compares tokens of any length", async () => {
    expect(await tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(await tokenMatches("", TOKEN)).toBe(false);
    expect(await tokenMatches(`${TOKEN}${TOKEN}`, TOKEN)).toBe(false);
  });
});
