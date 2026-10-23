// SPDX-License-Identifier: AGPL-3.0-or-later
// The worker image the solver host runs (M12.5, ADR-110, ADR-131). The deploy stores the image as
// a compressed `docker save` archive in R2 under its source tag and names the tag of the commit it
// deploys in WORKER_IMAGE_TAG; the host's image updater asks for it here and loads it between jobs.

import type { WorkerImage } from "@clearfea/spec";
import type { Env } from "../env";
import { r2Signer } from "./files";
import { presignUrl } from "./presign";

/** A source tag: a hash of worker/ and packages/spec/ (infra/vps/worker-archive.sh tag). */
export const WORKER_IMAGE_TAG = /^src-[0-9a-f]{20}$/;

/** How long the archive's presigned link stays valid: a few GB over a slow line, with room. */
export const WORKER_IMAGE_URL_SECONDS = 6 * 60 * 60;

/** Where the deploy stores the archive of a tag. */
export function workerImageKey(tag: string): string {
  return `worker-images/${tag}.tar.gz`;
}

export type WorkerImageAnswer = { image: WorkerImage } | { error: string; status: 400 | 404 };

/**
 * The image for the tag asked for (a pinned tag rolls back), else the deployed one. Its size and
 * SHA-256 come from the archive's R2 metadata, written by the deploy.
 */
export async function workerImage(env: Env, origin: string, asked: string | undefined): Promise<WorkerImageAnswer> {
  const tag = asked?.trim() || env.WORKER_IMAGE_TAG?.trim() || "";
  if (tag === "") {
    return {
      error:
        "This API names no worker image: WORKER_IMAGE_TAG is set only by the deploy (docs/DEPLOYMENT.md section 4.3). Pin a tag with ?tag= to load one by hand.",
      status: 404,
    };
  }
  if (!WORKER_IMAGE_TAG.test(tag)) {
    return { error: `${tag} is not a worker image tag; tags look like src- and 20 hex digits.`, status: 400 };
  }
  const key = workerImageKey(tag);
  const object = await env.FILES.head(key);
  const sha256 = object?.customMetadata?.sha256 ?? "";
  if (object === null || !/^[0-9a-f]{64}$/.test(sha256)) {
    return {
      error: `The worker image ${tag} is not in storage (${key}). Its deploy did not store it, or it was pruned; run the Deploy workflow from the commit that built it (docs/DEPLOYMENT.md section 4.3).`,
      status: 404,
    };
  }
  const signer = r2Signer(env);
  if (signer === null) {
    return {
      image: {
        tag,
        bytes: object.size,
        sha256,
        url: `${origin}/internal/worker-image/archive?tag=${encodeURIComponent(tag)}`,
      },
    };
  }
  return {
    image: {
      tag,
      bytes: object.size,
      sha256,
      url: await presignUrl(signer, "GET", key, WORKER_IMAGE_URL_SECONDS),
      urlSeconds: WORKER_IMAGE_URL_SECONDS,
    },
  };
}
