// SPDX-License-Identifier: AGPL-3.0-or-later
// Password hashing for the Phase 0 seeded test users (ADR-022). PBKDF2-SHA256 through
// Web Crypto, because Workers offer no native bcrypt or scrypt. 100 000 iterations is
// the most Workers allow. Format: pbkdf2-sha256$<iterations>$<salt, base64>$<hash, base64>.
// apps/api/scripts/hash-password.mjs writes the same format for the seed file.

const PREFIX = "pbkdf2-sha256";
export const ITERATIONS = 100_000;

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = new Uint8Array(await derive(password, salt, ITERATIONS));
  return `${PREFIX}$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** True when the password matches the stored hash. A malformed hash never matches. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [prefix, iterations, salt, hash] = stored.split("$");
  if (prefix !== PREFIX || salt === undefined || hash === undefined) return false;
  const count = Number(iterations);
  if (!Number.isInteger(count) || count < 1 || count > ITERATIONS) return false;
  const expected = fromBase64(hash);
  const actual = new Uint8Array(await derive(password, fromBase64(salt), count));
  return actual.byteLength === expected.byteLength && crypto.subtle.timingSafeEqual(actual, expected);
}
