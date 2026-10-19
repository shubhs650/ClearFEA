// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { pageOf } from "../src/pages";

describe("pageOf", () => {
  it("opens the workbench at /app", () => {
    expect(pageOf("/app")).toEqual({ kind: "workbench" });
    expect(pageOf("/app/")).toEqual({ kind: "workbench" });
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
