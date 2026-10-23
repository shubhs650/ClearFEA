// SPDX-License-Identifier: AGPL-3.0-or-later
// The worker image the solver host loads (M12.5, ADR-110, ADR-131): GET /internal/worker-image
// names the deployed or pinned tag's archive in R2, with its size, SHA-256 and a download link.
import { validateWorkerImage } from "@clearfea/spec";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { app } from "../src/index";
import { WORKER_IMAGE_URL_SECONDS, workerImageKey } from "../src/jobs/workerImage";

const TOKEN = "test-worker-token";
const DEPLOYED = "src-0123456789abcdef0123";
const OLDER = "src-fedcba9876543210fedc";
const ARCHIVE = new TextEncoder().encode("not really a docker save archive");
const SHA = "a".repeat(64);
const R2 = {
  R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_BUCKET: "clearfea-files",
};

function get(path: string, bindings: Env, token: string = TOKEN): Promise<Response> {
  return Promise.resolve(
    app.request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } }, bindings),
  );
}

beforeEach(async () => {
  for (const tag of [DEPLOYED, OLDER]) await env.FILES.delete(workerImageKey(tag));
  await env.FILES.put(workerImageKey(DEPLOYED), ARCHIVE, { customMetadata: { sha256: SHA } });
});

describe("GET /internal/worker-image (M12.5)", () => {
  it("names the deployed tag's archive, its size and SHA-256 and a presigned link", async () => {
    const response = await get("/internal/worker-image", { ...env, ...R2, WORKER_IMAGE_TAG: DEPLOYED });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(validateWorkerImage(body).ok).toBe(true);
    expect(body).toMatchObject({ tag: DEPLOYED, bytes: ARCHIVE.byteLength, sha256: SHA, urlSeconds: WORKER_IMAGE_URL_SECONDS });
    const url = new URL((body as { url: string }).url);
    expect(url.host).toBe(`${R2.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
    expect(url.pathname).toBe(`/clearfea-files/worker-images/${DEPLOYED}.tar.gz`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(WORKER_IMAGE_URL_SECONDS));
  });

  it("points at its own pass-through route without R2 keys, which streams the archive with the token", async () => {
    const bindings = { ...env, WORKER_IMAGE_TAG: DEPLOYED };
    const body = (await (await get("/internal/worker-image", bindings)).json()) as { url: string; urlSeconds?: number };
    expect(body.url).toBe(`http://localhost/internal/worker-image/archive?tag=${DEPLOYED}`);
    expect(body.urlSeconds).toBeUndefined();
    const archive = await get(`/internal/worker-image/archive?tag=${DEPLOYED}`, bindings);
    expect(archive.status).toBe(200);
    expect(new Uint8Array(await archive.arrayBuffer())).toEqual(ARCHIVE);
    expect((await get(`/internal/worker-image/archive?tag=${DEPLOYED}`, bindings, "wrong")).status).toBe(401);
    expect((await get(`/internal/worker-image/archive?tag=${OLDER}`, bindings)).status).toBe(404);
  });

  it("gives a pinned tag instead of the deployed one, so the host can roll back", async () => {
    await env.FILES.put(workerImageKey(OLDER), ARCHIVE, { customMetadata: { sha256: SHA } });
    const response = await get(`/internal/worker-image?tag=${OLDER}`, { ...env, WORKER_IMAGE_TAG: DEPLOYED });
    expect(((await response.json()) as { tag: string }).tag).toBe(OLDER);
  });

  it("says plainly when no image is named, the tag is malformed or the archive is missing", async () => {
    const none = await get("/internal/worker-image", env);
    expect(none.status).toBe(404);
    expect(((await none.json()) as { error: string }).error).toMatch(/WORKER_IMAGE_TAG/);
    expect((await get("/internal/worker-image?tag=latest", env)).status).toBe(400);
    const missing = await get(`/internal/worker-image?tag=${OLDER}`, env);
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as { error: string }).error).toMatch(/not in storage/);
  });

  it("does not offer an archive the deploy did not finish, which has no SHA-256 yet", async () => {
    await env.FILES.put(workerImageKey(OLDER), ARCHIVE);
    expect((await get(`/internal/worker-image?tag=${OLDER}`, env)).status).toBe(404);
  });

  it("needs the worker token", async () => {
    expect((await get("/internal/worker-image", { ...env, WORKER_IMAGE_TAG: DEPLOYED }, "wrong")).status).toBe(401);
  });
});
