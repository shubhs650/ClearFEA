// SPDX-License-Identifier: AGPL-3.0-or-later
// Google sign-in (M10.3, ADR-097) through the API's own routes, with Google's token endpoint
// answered here: the sign-in start, Google's callback, the allowlist checked at user and session
// creation, the admin page's routes, sign-out, and the password login refused in "google" mode.
import { validateAdminResponse, validateSessionResponse, validateSignInOptions } from "@clearfea/spec";
import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../src/index";
import type { Env } from "../src/env";

const ADMIN = "Admin.Person@Gmail.com";
const GOOGLE: Env = {
  ...env,
  AUTH_MODE: "google",
  BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef0123456789",
  BETTER_AUTH_URL: "http://localhost",
  GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  ADMIN_EMAIL: ADMIN,
};

/** Cookies a browser would hold, by name. */
type Jar = Map<string, string>;

function remember(jar: Jar, response: Response): void {
  for (const header of response.headers.getSetCookie()) {
    const [pair = ""] = header.split(";");
    const at = pair.indexOf("=");
    const name = pair.slice(0, at);
    const value = pair.slice(at + 1);
    if (value === "" || /max-age=0/i.test(header)) jar.delete(name);
    else jar.set(name, value);
  }
}

function call(
  method: string,
  path: string,
  options: { jar?: Jar; json?: unknown; config?: Env } = {},
): Promise<Response> {
  const headers: Record<string, string> = { Origin: "http://localhost" };
  if (options.json !== undefined) headers["Content-Type"] = "application/json";
  if (options.jar && options.jar.size > 0) {
    headers.Cookie = [...options.jar].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  const request = new Request(`http://localhost${path}`, {
    method,
    headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
    redirect: "manual",
  });
  return Promise.resolve(app.fetch(request, options.config ?? GOOGLE));
}

/** An unsigned ID token: Better Auth reads the code flow's token from Google's own answer. */
function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => btoa(JSON.stringify(value)).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
  return `${part({ alg: "RS256", typ: "JWT" })}.${part(claims)}.signature`;
}

/** What Google's token endpoint answers next: an account with this address. */
let account: { sub: string; email: string; verified: boolean; name: string };
const realFetch = globalThis.fetch;

beforeAll(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith("https://oauth2.googleapis.com/token")) return realFetch(input, init);
    return Response.json({
      access_token: "access",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid email profile",
      id_token: idToken({
        iss: "https://accounts.google.com",
        aud: GOOGLE.GOOGLE_CLIENT_ID,
        sub: account.sub,
        email: account.email,
        email_verified: account.verified,
        name: account.name,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    });
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM allowed_emails"),
    env.DB.prepare("DELETE FROM auth_sessions"),
    env.DB.prepare("DELETE FROM auth_accounts"),
    env.DB.prepare("DELETE FROM auth_verifications"),
    env.DB.prepare("DELETE FROM ledger_entries"),
    env.DB.prepare("DELETE FROM users"),
  ]);
});

/**
 * Signs in as a browser does: starts at the API, goes to Google (skipped: Google sends the code
 * straight back), and follows the callback. Returns where the callback sent the browser.
 */
async function signInWithGoogle(
  who: { sub: string; email: string; verified?: boolean; name?: string },
  jar: Jar = new Map(),
): Promise<{ location: URL; jar: Jar }> {
  account = { verified: true, name: "Test Person", ...who };
  const start = await call("POST", "/api/auth/sign-in/social", {
    jar,
    json: { provider: "google", callbackURL: "/app", errorCallbackURL: "/app" },
  });
  expect(start.status, await start.clone().text()).toBe(200);
  remember(jar, start);
  const { url } = (await start.json()) as { url: string };
  const google = new URL(url);
  expect(google.origin).toBe("https://accounts.google.com");
  expect(google.searchParams.get("redirect_uri")).toBe("http://localhost/api/auth/callback/google");
  const state = google.searchParams.get("state") ?? "";

  const callback = await call("GET", `/api/auth/callback/google?code=test-code&state=${encodeURIComponent(state)}`, { jar });
  expect(callback.status, await callback.clone().text()).toBe(302);
  remember(jar, callback);
  return { location: new URL(callback.headers.get("Location") ?? "", "http://localhost"), jar };
}

async function sessionUser(jar: Jar) {
  const response = await call("GET", "/api/session", { jar });
  if (response.status !== 200) return { status: response.status, user: null };
  const checked = validateSessionResponse(await response.json());
  if (!checked.ok) throw new Error(checked.errors.join(" "));
  return { status: 200, user: checked.value.user };
}

describe("Google sign-in", () => {
  it("lets the admin in by the configured address, in any case, and makes them a user with the grant", async () => {
    const { location, jar } = await signInWithGoogle({ sub: "g-admin", email: "admin.person@gmail.com" });
    expect(location.pathname).toBe("/app");
    expect(location.searchParams.get("error")).toBeNull();

    const { user } = await sessionUser(jar);
    expect(user).toMatchObject({ login: "admin.person@gmail.com", name: "Test Person", admin: true });
    expect(user?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const ledger = await env.DB.prepare("SELECT amount, balance, reason FROM ledger_entries WHERE owner_id = ?")
      .bind(user?.id)
      .all();
    expect(ledger.results).toEqual([{ amount: 100_000_000, balance: 100_000_000, reason: "grant" }]);

    // Signed-in routes take the Google session as they took the local one.
    expect((await call("GET", "/api/wallet", { jar })).status).toBe(200);
  });

  it("refuses an address that is not invited, and keeps no trace of it", async () => {
    const { location, jar } = await signInWithGoogle({ sub: "g-stranger", email: "stranger@gmail.com" });
    expect(location.pathname).toBe("/app");
    expect(location.searchParams.get("error")).toBe("NOT_INVITED");
    expect((await sessionUser(jar)).status).toBe(401);
    const users = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    expect(users?.n).toBe(0);
  });

  it("refuses an address Google has not verified, even the admin's", async () => {
    const { location } = await signInWithGoogle({ sub: "g-admin", email: ADMIN, verified: false });
    expect(location.searchParams.get("error")).toBe("NOT_INVITED");
  });

  it("lets in an address the admin added, and locks it out again when it is removed", async () => {
    const { jar: admin } = await signInWithGoogle({ sub: "g-admin", email: ADMIN });
    const added = await call("POST", "/api/admin/allowed", { jar: admin, json: { email: "  Colleague@Gmail.com " } });
    expect(added.status).toBe(200);
    const view = validateAdminResponse(await added.json());
    expect(view.ok && view.value.allowed.map((a) => a.email)).toEqual(["colleague@gmail.com"]);

    const { location, jar: colleague } = await signInWithGoogle({ sub: "g-colleague", email: "colleague@gmail.com" });
    expect(location.searchParams.get("error")).toBeNull();
    expect((await sessionUser(colleague)).user).toMatchObject({ login: "colleague@gmail.com", admin: false });
    // Not the admin: the admin routes answer as if they did not exist.
    expect((await call("GET", "/api/admin", { jar: colleague })).status).toBe(404);

    const listed = validateAdminResponse(await (await call("GET", "/api/admin", { jar: admin })).json());
    if (!listed.ok) throw new Error(listed.errors.join(" "));
    expect(listed.value.adminEmail).toBe("admin.person@gmail.com");
    expect(listed.value.users.map((u) => [u.email, u.allowed, u.lastSignIn !== null])).toEqual(
      expect.arrayContaining([
        ["admin.person@gmail.com", true, true],
        ["colleague@gmail.com", true, true],
      ]),
    );

    const removed = await call("DELETE", "/api/admin/allowed/colleague%40gmail.com", { jar: admin });
    expect(removed.status).toBe(200);
    // Signed out at once, and refused at the next sign-in although the user row stays.
    expect((await sessionUser(colleague)).status).toBe(401);
    const again = await signInWithGoogle({ sub: "g-colleague", email: "colleague@gmail.com" });
    expect(again.location.searchParams.get("error")).toBe("NOT_INVITED");
    const stays = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'colleague@gmail.com'").first<{ n: number }>();
    expect(stays?.n).toBe(1);
    // The admin is still signed in.
    expect((await sessionUser(admin)).status).toBe(200);
  });

  it("gives a returning user their same account and no second grant", async () => {
    const first = await signInWithGoogle({ sub: "g-admin", email: ADMIN });
    const second = await signInWithGoogle({ sub: "g-admin", email: ADMIN });
    const a = await sessionUser(first.jar);
    const b = await sessionUser(second.jar);
    expect(b.user?.id).toBe(a.user?.id);
    const grants = await env.DB.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE reason = 'grant'").first<{ n: number }>();
    expect(grants?.n).toBe(1);
  });

  it("signs out by ending the session, not only the cookie", async () => {
    const { jar } = await signInWithGoogle({ sub: "g-admin", email: ADMIN });
    const copied = new Map(jar);
    const out = await call("DELETE", "/api/session", { jar });
    expect(out.status).toBe(204);
    remember(jar, out);
    expect((await sessionUser(jar)).status).toBe(401);
    // A copy of the old cookie no longer works either.
    expect((await sessionUser(copied)).status).toBe(401);
  });

  it("refuses the password login and says to use Google", async () => {
    const response = await call("POST", "/api/session", { json: { login: "alice", password: "alice-local" } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: expect.stringContaining("Sign in with Google") });
    const options = validateSignInOptions(await (await call("GET", "/api/session/options")).json());
    expect(options.ok && options.value).toEqual({ signIn: "google" });
  });

  it("names what is missing when Google sign-in is not set up", async () => {
    const config = { ...GOOGLE, GOOGLE_CLIENT_ID: undefined, BETTER_AUTH_SECRET: "" };
    for (const [method, path] of [
      ["GET", "/api/session"],
      ["GET", "/api/wallet"],
      ["POST", "/api/auth/sign-in/social"],
    ] as const) {
      const response = await call(method, path, { config, json: method === "POST" ? { provider: "google" } : undefined });
      expect(response.status, path).toBe(503);
      const { error } = (await response.json()) as { error: string };
      expect(error, path).toContain("BETTER_AUTH_SECRET, GOOGLE_CLIENT_ID");
    }
  });

  it("refuses everything signed-in for an unknown sign-in mode", async () => {
    const response = await call("GET", "/api/wallet", { config: { ...GOOGLE, AUTH_MODE: "both" } });
    expect(response.status).toBe(503);
  });
});

describe("local sign-in mode", () => {
  const LOCAL: Env = { ...env, AUTH_MODE: undefined };

  it("does not answer Better Auth's routes", async () => {
    const response = await call("POST", "/api/auth/sign-in/social", { config: LOCAL, json: { provider: "google" } });
    expect(response.status).toBe(404);
    const options = validateSignInOptions(await (await call("GET", "/api/session/options", { config: LOCAL })).json());
    expect(options.ok && options.value).toEqual({ signIn: "password" });
  });
});
