// SPDX-License-Identifier: AGPL-3.0-or-later
// Which page a path opens. One origin serves every page and the API (ADR-095): the landing page
// at /, the projects home at /app (M14.3), a project's workbench at /app/p/<id> and read-only
// share links at /share/<token>.

import { shareTokenOf } from "./api/shareLinks";

export const WORKBENCH_PATH = "/app";

export type Page =
  | { kind: "home" }
  | { kind: "project"; id: string }
  | { kind: "shared"; token: string }
  | { kind: "landing" }
  | { kind: "missing" };

const PROJECT = /^\/app\/p\/([^/]+)\/?$/;

/** The workbench of one project. */
export function projectPath(id: string): string {
  return `${WORKBENCH_PATH}/p/${encodeURIComponent(id)}`;
}

export function pageOf(pathname: string): Page {
  const token = shareTokenOf(pathname);
  if (token !== null) return { kind: "shared", token };
  if (pathname === "/") return { kind: "landing" };
  if (pathname === WORKBENCH_PATH || pathname === `${WORKBENCH_PATH}/`) return { kind: "home" };
  const project = PROJECT.exec(pathname)?.[1];
  if (project !== undefined) {
    try {
      return { kind: "project", id: decodeURIComponent(project) };
    } catch {
      return { kind: "missing" };
    }
  }
  return { kind: "missing" };
}
