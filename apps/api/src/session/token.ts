// SPDX-License-Identifier: AGPL-3.0-or-later
// Signed session tokens (ADR-022): v1.<user id>.<expiry, Unix seconds>.<HMAC-SHA256, base64url>.
// Stateless: the API keeps no session table, so signing out clears the cookie but cannot
// revoke a copied token before it expires. Acceptable for local test users in Phase 0.

const VERSION = "v1";

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

export async function issueToken(secret: string, userId: string, expiresAt: number): Promise<string> {
  const body = `${VERSION}.${userId}.${expiresAt}`;
  return `${body}.${await sign(secret, body)}`;
}

/** The user id a token was issued for, or null if it is malformed, forged or expired. */
export async function readToken(secret: string, token: string, now: number): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [version, userId, expiry, signature] = parts as [string, string, string, string];
  if (version !== VERSION || userId === "") return null;
  const expected = await sign(secret, `${version}.${userId}.${expiry}`);
  const encoder = new TextEncoder();
  const given = encoder.encode(signature);
  const wanted = encoder.encode(expected);
  if (given.byteLength !== wanted.byteLength || !crypto.subtle.timingSafeEqual(given, wanted)) {
    return null;
  }
  const expiresAt = Number(expiry);
  if (!Number.isInteger(expiresAt) || expiresAt <= now) return null;
  return userId;
}
