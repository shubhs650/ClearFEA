// SPDX-License-Identifier: AGPL-3.0-or-later
// Presigned R2 URLs for job files (M10.5, ADR-098).
import { describe, expect, it } from "vitest";
import type { Job } from "../src/db/jobs";
import type { Env } from "../src/env";
import { PRESIGN_DEFAULT_SECONDS, PRESIGN_MARGIN_SECONDS, presignSeconds, r2Signer, transfers } from "../src/jobs/files";
import { MAX_PRESIGN_SECONDS, presignUrl, type R2Signer } from "../src/jobs/presign";

const R2: R2Signer = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  endpoint: "https://abc123.r2.cloudflarestorage.com",
  bucket: "clearfea-files",
  region: "auto",
};

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const configured = {
  R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_ACCOUNT_ID: ACCOUNT,
  R2_BUCKET: "clearfea-files",
} as Env;

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    ownerId: "owner-1",
    type: "import",
    targetId: "geometry-1",
    status: "claimed",
    stage: null,
    claimedBy: "w1",
    heartbeatAt: null,
    failureCategory: null,
    failureCause: null,
    failureMessage: null,
    params: { confirmedUnit: null },
    result: null,
    software: null,
    machineSize: null,
    ratePerHour: null,
    billableMs: null,
    billedSeconds: null,
    cost: null,
    stopRequested: null,
    stopMultiplier: null,
    stopAfterSeconds: null,
    attempt: 1,
    peakMemoryBytes: null,
    createdAt: "2026-10-19 07:00:00",
    claimedAt: "2026-10-19 07:00:01",
    finishedAt: null,
    ...overrides,
  };
}

describe("presignUrl", () => {
  it("matches AWS's published example of a presigned GET", async () => {
    // docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html, virtual-hosted style.
    const url = await presignUrl(
      {
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        endpoint: "https://examplebucket.s3.amazonaws.com",
        bucket: "",
        region: "us-east-1",
      },
      "GET",
      "test.txt",
      86400,
      new Date("2013-05-24T00:00:00Z"),
    );
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("matches botocore's path-style R2 URLs for GET and PUT, with an escaped key", async () => {
    // botocore 1.43.114 generate_presigned_url, region auto, path addressing (ADR-098).
    const at = new Date("2026-10-19T07:15:42Z");
    const key = "users/u-1/runs/r 1/results.frd";
    const base =
      "https://abc123.r2.cloudflarestorage.com/clearfea-files/users/u-1/runs/r%201/results.frd?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
      "&X-Amz-Credential=AKIDEXAMPLE%2F20261019%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20261019T071542Z" +
      "&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=";
    expect(await presignUrl(R2, "GET", key, 3600, at)).toBe(
      `${base}8a9f8a4abaf5829815ec4ff0787f9da23606d5f9437ecd7728c1a48459aa7ea1`,
    );
    expect(await presignUrl(R2, "PUT", key, 3600, at)).toBe(
      `${base}b20741be2abfae3663212b6fc0a7a0584358c321b7aa5e3c85cab6513d7dc9cc`,
    );
  });

  it("never asks for more than R2's seven days", async () => {
    const url = new URL(await presignUrl(R2, "GET", "a", 30 * 24 * 3600));
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(MAX_PRESIGN_SECONDS));
  });
});

describe("job transfer URLs", () => {
  it("use the API's pass-through routes unless all four R2 settings are there", async () => {
    for (const missing of Object.keys(configured)) {
      expect(r2Signer({ ...configured, [missing]: "" })).toBeNull();
    }
    const [first] = await transfers(job(), "w 1", "http://127.0.0.1:8787", {} as Env);
    expect(first).toEqual({
      name: "model.step",
      direction: "download",
      url: "http://127.0.0.1:8787/internal/jobs/job-1/files/model.step?worker=w%201",
    });
  });

  it("are presigned GETs and PUTs of each file's own key when R2 is configured", async () => {
    const list = await transfers(job(), "w1", "https://clearfea.triyalabs.com", configured);
    expect(list.map((t) => [t.name, t.direction])).toEqual([
      ["model.step", "download"],
      ["topology.json", "upload"],
      ["display.bin", "upload"],
    ]);
    for (const t of list) {
      const url = new URL(t.url);
      expect(url.origin).toBe(`https://${ACCOUNT}.r2.cloudflarestorage.com`);
      expect(url.pathname).toBe(`/clearfea-files/owners/owner-1/geometries/geometry-1/${t.name}`);
      expect(url.searchParams.get("X-Amz-Credential")).toMatch(/^AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request$/);
      expect(url.searchParams.get("X-Amz-Expires")).toBe(String(PRESIGN_DEFAULT_SECONDS));
    }
    // The method is part of what is signed, so a download URL cannot be used to upload.
    const signature = (i: number) => new URL(list[i]?.url ?? "").searchParams.get("X-Amz-Signature");
    expect(signature(0)).not.toBe(signature(1));
  });

  it("stay valid for the run's stop limit plus the margin", () => {
    expect(presignSeconds(job({ type: "solve", stopAfterSeconds: 900 }))).toBe(900 + PRESIGN_MARGIN_SECONDS);
    expect(presignSeconds(job({ type: "mesh" }))).toBe(PRESIGN_DEFAULT_SECONDS);
  });
});
