// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHealth } from "../src/api/health";
import { accessExpired, apiBinary, apiRequest } from "../src/api/request";

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

  it("shows in the status bar's health check", async () => {
    accessRedirect();
    expect(await fetchHealth()).toEqual({ kind: "unreachable", problems: [accessExpired] });
  });
});
