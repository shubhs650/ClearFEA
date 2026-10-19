// SPDX-License-Identifier: AGPL-3.0-or-later
// The landing page at / (M10.4): its way in to the workbench, and its verification numbers,
// which must be the ones on the verification results page.

/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VERIFICATION_ROWS, VERIFICATION_SUMMARY } from "../src/landing/content";
import { LandingPage } from "../src/landing/LandingPage";

type Reply = { status: number; json: unknown };

function serve(routes: Record<string, Reply>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${String(input)}`;
      const reply = routes[key];
      if (reply === undefined) throw new Error(`Unexpected request ${key}`);
      return new Response(JSON.stringify(reply.json), { status: reply.status });
    }),
  );
}

const google = { status: 200, json: { signIn: "google" } };
const password = { status: 200, json: { signIn: "password" } };
const signedOut = { status: 401, json: { error: "You are not signed in." } };
const signedIn = { status: 200, json: { user: { id: "u1", login: "alice", name: "Alice", admin: false } } };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the landing page", () => {
  it("sends a signed-out visitor to the workbench's Google sign-in", async () => {
    serve({ "GET /api/session": signedOut, "GET /api/session/options": google });
    render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Finite element analysis, in your browser");
    const signIns = await screen.findAllByRole("link", { name: "Sign in with Google" });
    expect(signIns.length).toBe(2);
    for (const link of [...signIns, screen.getByRole("link", { name: "Sign in" })]) {
      expect(link.getAttribute("href")).toBe("/app");
    }
  });

  it("says just Sign in where the workbench signs in with a password", async () => {
    serve({ "GET /api/session": signedOut, "GET /api/session/options": password });
    render(<LandingPage />);
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBe(3));
    expect(screen.queryByRole("link", { name: "Sign in with Google" })).toBeNull();
  });

  it("offers a signed-in visitor the workbench instead", async () => {
    serve({ "GET /api/session": signedIn, "GET /api/session/options": google });
    render(<LandingPage />);
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Open the workbench" }).length).toBe(3));
    expect(screen.queryByRole("link", { name: "Sign in with Google" })).toBeNull();
  });

  it("states no verdict, only numbers", () => {
    serve({ "GET /api/session": signedOut, "GET /api/session/options": google });
    const { container } = render(<LandingPage />);
    expect(container.textContent).not.toMatch(/\b(PASS|FAIL|passed|failed|compliant)\b/i);
  });
});

describe("the landing page's verification numbers", () => {
  const page = readFileSync(join(import.meta.dirname, "../../../docs/VERIFICATION_RESULTS.md"), "utf8");

  it("are the totals of the verification results page", () => {
    const s = VERIFICATION_SUMMARY;
    expect(page).toContain(`${s.cases} cases, ${s.checksWithin} of ${s.checks} checks within tolerance`);
    expect(page).toContain(`${s.acceptanceCases} cases, ${s.acceptanceChecksWithin} of ${s.acceptanceChecks} checks within tolerance`);
  });

  it.each(VERIFICATION_ROWS)("$caseName: $label is the results page's row", (row) => {
    const section = page.split(`### ${row.caseName}\n`)[1]?.split("\n### ")[0];
    expect(section, `docs/VERIFICATION_RESULTS.md has no section for ${row.caseName}`).toBeDefined();
    const line = section?.split("\n").find((text) => text.startsWith(`| ${row.check} |`));
    expect(line, `${row.caseName} has no check "${row.check}"`).toBeDefined();
    const cells = line?.split(" | ").map((cell) => cell.replace(/^\| /, "").trim()) ?? [];
    expect(cells[1]).toBe(row.reference);
    expect(cells[2]?.startsWith(`${row.clearfea} (`)).toBe(true);
    expect(cells[3]).toBe(row.error);
    expect(cells[5]).toBe("yes |");
  });
});
