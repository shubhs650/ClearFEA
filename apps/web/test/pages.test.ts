// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { pageOf, projectPath } from "../src/pages";

describe("pageOf", () => {
  it("opens the projects home at /app and a project's workbench at /app/p/<id> (M14.3)", () => {
    expect(pageOf("/app")).toEqual({ kind: "home" });
    expect(pageOf("/app/")).toEqual({ kind: "home" });
    expect(pageOf("/app/p/0c6f")).toEqual({ kind: "project", id: "0c6f" });
    expect(pageOf("/app/p/0c6f/")).toEqual({ kind: "project", id: "0c6f" });
    expect(pageOf(projectPath("a b"))).toEqual({ kind: "project", id: "a b" });
    expect(pageOf("/app/p/")).toEqual({ kind: "missing" });
    expect(pageOf("/app/p/a/b")).toEqual({ kind: "missing" });
    expect(pageOf("/app/p/%E0%A4%A")).toEqual({ kind: "missing" });
  });

  it("opens a share link's run", () => {
    expect(pageOf("/share/abc123")).toEqual({ kind: "shared", token: "abc123" });
  });

  it("keeps / for the landing page", () => {
    expect(pageOf("/")).toEqual({ kind: "landing" });
  });

  it("finds no page at any other address", () => {
    expect(pageOf("/apps")).toEqual({ kind: "missing" });
    expect(pageOf("/share/abc/extra")).toEqual({ kind: "missing" });
    expect(pageOf("/api/health")).toEqual({ kind: "missing" });
  });
});
