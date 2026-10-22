// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHealth } from "../src/api/health";
import { accessExpired, apiBinary, apiDownload, apiRequest, attachmentName } from "../src/api/request";

// What fetch gives for a redirect it was told not to follow: Cloudflare Access sending an
// expired sign-in to its own page (ADR-111).
function accessRedirect() {
  const fetchMock = vi.fn(async () => ({ type: "opaqueredirect", ok: false, status: 0 }) as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("an expired Cloudflare Access sign-in", () => {
  it("is named on API requests, which do not follow redirects", async () => {
    const fetchMock = accessRedirect();
    expect(await apiRequest("GET", "/api/jobs", null)).toEqual({ kind: "error", problem: accessExpired });
    expect(fetchMock).toHaveBeenCalledWith("/api/jobs", expect.objectContaining({ redirect: "manual" }));
  });

  it("is named on binary downloads", async () => {
    accessRedirect();
    expect(await apiBinary("/api/runs/r1/surface")).toEqual({ kind: "error", problem: accessExpired });
  });

  it("is named on the admin's exports (M13.4)", async () => {
    accessRedirect();
    expect(await apiDownload("/api/admin/export/jobs.csv", "jobs.csv")).toEqual({ kind: "error", problem: accessExpired });
  });

  it("shows in the status bar's health check", async () => {
    accessRedirect();
    expect(await fetchHealth()).toEqual({ kind: "unreachable", problems: [accessExpired] });
  });
});

describe("a download's file name (M13.4)", () => {
  it("comes from Content-Disposition, or the fallback", () => {
    expect(attachmentName('attachment; filename="clearfea-jobs-2026-10-01-to-2026-10-22.csv"', "x.csv")).toBe(
      "clearfea-jobs-2026-10-01-to-2026-10-22.csv",
    );
    expect(attachmentName(null, "x.csv")).toBe("x.csv");
    expect(attachmentName("attachment", "x.csv")).toBe("x.csv");
  });

  it("names the API's refusal", async () => {
    const refusal = { error: "Choose a shorter range and export it in parts." };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(refusal), { status: 400 })),
    );
    expect(await apiDownload("/api/admin/export/jobs.csv", "jobs.csv")).toEqual({ kind: "error", problem: refusal.error });
  });
});
