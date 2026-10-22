// SPDX-License-Identifier: AGPL-3.0-or-later
// Google sign-in for the live closed beta (M10.3, ADR-095 item 3, ADR-097): Better Auth inside the
// API at /api/auth, with D1 as its database and Google as its one provider. A sign-in is refused
// unless the account's verified address is the admin's (ADMIN_EMAIL) or on the allowlist,
// checked when the user is created and again whenever a session is created. A user's first
// sign-in creates their ClearFEA user row, with their address as login, and the play-money grant.
// Each sign-in and each refusal is an event (M13.1, ADR-125).

import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { isAllowed } from "../db/allowlist";
import { recordEvent } from "../db/events";
import { grantStatement } from "../billing/ledger";
import type { Env } from "../env";

/** The code Better Auth appends to the error address (`?error=NOT_INVITED`) for a refused address. */
export const NOT_INVITED = "NOT_INVITED";

export const NOT_INVITED_MESSAGE =
  "This Google account is not invited to the ClearFEA closed beta. Ask the person who invited you to add this exact address, or sign in with the account they invited.";

/** How long a Google sign-in lasts, in seconds; the same week as a local sign-in. */
const SESSION_LIFETIME = 7 * 24 * 60 * 60;

/** The settings Google sign-in needs, or the names of the missing ones. */
export function googleSettings(
  env: Env,
): { ok: true; secret: string; baseURL: string; clientId: string; clientSecret: string } | { ok: false; missing: string[] } {
  const wanted = {
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
  };
  const missing = Object.entries(wanted)
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    secret: wanted.BETTER_AUTH_SECRET as string,
    baseURL: wanted.BETTER_AUTH_URL as string,
    clientId: wanted.GOOGLE_CLIENT_ID as string,
    clientSecret: wanted.GOOGLE_CLIENT_SECRET as string,
  };
}

function refuse(): never {
  throw new APIError("FORBIDDEN", { code: NOT_INVITED, message: NOT_INVITED_MESSAGE });
}

/** Records a refused Google sign-in, then refuses it. */
async function refuseAndRecord(db: D1Database, email: string | null, verified: boolean, userId: string | null): Promise<never> {
  const why = verified ? "it is not invited" : "Google has not verified the address";
  await recordEvent(db, {
    kind: "sign_in_refused",
    level: "warning",
    userId,
    message: `A Google sign-in as ${email ?? "an account without an address"} was refused: ${why}.`,
    detail: { method: "google", email, reason: verified ? "not_invited" : "unverified" },
  });
  refuse();
}

/** Better Auth for one request. Call only when `googleSettings(env)` is ok. */
export function googleAuth(env: Env) {
  const settings = googleSettings(env);
  if (!settings.ok) throw new Error(`Google sign-in is missing ${settings.missing.join(", ")}.`);
  const db = env.DB;
  return betterAuth({
    appName: "ClearFEA",
    baseURL: settings.baseURL,
    basePath: "/api/auth",
    secret: settings.secret,
    database: db,
    telemetry: { enabled: false },
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: settings.clientId,
        clientSecret: settings.clientSecret,
        prompt: "select_account",
      },
    },
    user: {
      modelName: "users",
      fields: { emailVerified: "email_verified", createdAt: "created_at", updatedAt: "updated_at" },
      additionalFields: { login: { type: "string", required: false, input: false } },
    },
    session: {
      modelName: "auth_sessions",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      expiresIn: SESSION_LIFETIME,
    },
    account: {
      modelName: "auth_accounts",
      fields: {
        userId: "user_id",
        accountId: "account_id",
        providerId: "provider_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "auth_verifications",
      fields: { expiresAt: "expires_at", createdAt: "created_at", updatedAt: "updated_at" },
    },
    advanced: {
      cookiePrefix: "clearfea",
      // ClearFEA's user ids are UUIDs (migration 0001).
      database: { generateId: "uuid" },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!user.emailVerified || !(await isAllowed(db, user.email, env.ADMIN_EMAIL))) {
              await refuseAndRecord(db, user.email, user.emailVerified, null);
            }
            return { data: { ...user, login: user.email.trim().toLowerCase() } };
          },
          after: async (user) => {
            await grantStatement(db, user.id).run();
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const row = await db
              .prepare("SELECT email, email_verified FROM users WHERE id = ?")
              .bind(session.userId)
              .first<{ email: string | null; email_verified: number }>();
            if (row?.email == null || row.email_verified !== 1 || !(await isAllowed(db, row.email, env.ADMIN_EMAIL))) {
              await refuseAndRecord(db, row?.email ?? null, row?.email_verified === 1, row === null ? null : session.userId);
            }
          },
          after: async (session) => {
            const row = await db.prepare("SELECT email FROM users WHERE id = ?").bind(session.userId).first<{ email: string | null }>();
            await recordEvent(db, {
              kind: "sign_in",
              level: "info",
              userId: session.userId,
              message: `${row?.email ?? "A user"} signed in with Google.`,
              detail: { method: "google", email: row?.email ?? null },
            });
          },
        },
      },
    },
  });
}
