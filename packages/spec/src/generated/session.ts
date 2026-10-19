// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/session.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/session.schema.json";
import { validator } from "../validate";

/**
 * Wire shapes of the session routes (docs/ARCHITECTURE.md section 8, ADR-022, ADR-097). Each message is a definition under $defs.
 */
export interface Session {
  [k: string]: unknown;
}
/**
 * Body of POST /api/session.
 *
 * This interface was referenced by `Session`'s JSON-Schema
 * via the `definition` "LoginRequest".
 */
export interface LoginRequest {
  login: string;
  password: string;
}
/**
 * This interface was referenced by `Session`'s JSON-Schema
 * via the `definition` "SessionUser".
 */
export interface SessionUser {
  id: string;
  login: string;
  name: string;
  /**
   * True for the admin (ADMIN_EMAIL), who sees the admin page (M10.3).
   */
  admin: boolean;
}
/**
 * Answer to POST /api/session and GET /api/session when signed in (HTTP 200). Not signed in is HTTP 401 with an ErrorResponse.
 *
 * This interface was referenced by `Session`'s JSON-Schema
 * via the `definition` "SessionResponse".
 */
export interface SessionResponse {
  user: SessionUser;
}
/**
 * Answer to GET /api/session/options: how this site signs people in (AUTH_MODE, ADR-097). "password" for the seeded local test users, "google" for Google sign-in on the live site.
 *
 * This interface was referenced by `Session`'s JSON-Schema
 * via the `definition` "SignInOptions".
 */
export interface SignInOptions {
  signIn: "password" | "google";
}

export const validateLoginRequest = validator<LoginRequest>(schema, "LoginRequest");
export const validateSessionUser = validator<SessionUser>(schema, "SessionUser");
export const validateSessionResponse = validator<SessionResponse>(schema, "SessionResponse");
export const validateSignInOptions = validator<SignInOptions>(schema, "SignInOptions");
