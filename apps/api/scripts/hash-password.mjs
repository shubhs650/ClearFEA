// SPDX-License-Identifier: AGPL-3.0-or-later
// Prints a password hash in the format src/session/password.ts verifies, for seed/test-users.sql.
// Usage: node apps/api/scripts/hash-password.mjs <password>

import { webcrypto } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("Usage: node apps/api/scripts/hash-password.mjs <password>");
  process.exit(1);
}

const iterations = 100_000;
const salt = webcrypto.getRandomValues(new Uint8Array(16));
const key = await webcrypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(password),
  "PBKDF2",
  false,
  ["deriveBits"],
);
const hash = await webcrypto.subtle.deriveBits(
  { name: "PBKDF2", hash: "SHA-256", salt, iterations },
  key,
  256,
);
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
console.log(`pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(new Uint8Array(hash))}`);
