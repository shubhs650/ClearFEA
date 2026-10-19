// SPDX-License-Identifier: AGPL-3.0-or-later
// Which page a path opens. One origin serves every page and the API (ADR-095): the landing page
// at /, the workbench at /app and read-only share links at /share/<token>.

import { shareTokenOf } from "./api/shareLinks";

export const WORKBENCH_PATH = "/app";

export type Page = { kind: "workbench" } | { kind: "shared"; token: string } | { kind: "landing" } | { kind: "missing" };

export function pageOf(pathname: string): Page {
  const token = shareTokenOf(pathname);
  if (token !== null) return { kind: "shared", token };
  if (pathname === "/") return { kind: "landing" };
  if (pathname === WORKBENCH_PATH || pathname === `${WORKBENCH_PATH}/`) return { kind: "workbench" };
  return { kind: "missing" };
}
