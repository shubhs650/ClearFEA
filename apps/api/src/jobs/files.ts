// SPDX-License-Identifier: AGPL-3.0-or-later
// The files each job type reads and writes (ADR-005). The worker sees only names and the
// transfer URLs built from them; which storage key a name maps to is decided here.

import type { ReportJobParams, RunView, Transfer } from "@clearfea/spec";
import { type GeometryFile, geometryKey } from "../db/geometries";
import type { Job } from "../db/jobs";
import { type MeshFile, meshKey } from "../db/meshes";
import { figureKey, logoKey } from "../db/report";
import { reportKey } from "../db/reports";
import { type RunFile, runKey } from "../db/runs";
import type { Env } from "../env";
import { presignUrl, type R2Signer } from "./presign";

export interface JobFile {
  name: string;
  direction: Transfer["direction"];
  key: string;
}

export function jobFiles(job: Job): JobFile[] {
  const target = job.targetId;
  if (job.type === "import" && target !== null) {
    const key = (name: GeometryFile) => geometryKey(job.ownerId, target, name);
    return [
      { name: "model.step", direction: "download", key: key("model.step") },
      { name: "topology.json", direction: "upload", key: key("topology.json") },
      { name: "display.bin", direction: "upload", key: key("display.bin") },
    ];
  }
  const geometryId = job.params?.geometryId;
  if (job.type === "mesh" && target !== null && typeof geometryId === "string") {
    const geometry = (name: GeometryFile) => geometryKey(job.ownerId, geometryId, name);
    const mesh = (name: MeshFile) => meshKey(job.ownerId, target, name);
    return [
      { name: "model.step", direction: "download", key: geometry("model.step") },
      { name: "topology.json", direction: "download", key: geometry("topology.json") },
      { name: "mesh.bin", direction: "upload", key: mesh("mesh.bin") },
      { name: "display.bin", direction: "upload", key: mesh("display.bin") },
    ];
  }
  const meshId = job.params?.meshId;
  if (job.type === "solve" && target !== null && typeof meshId === "string") {
    const run = (name: RunFile) => runKey(job.ownerId, target, name);
    return [
      { name: "mesh.bin", direction: "download", key: meshKey(job.ownerId, meshId, "mesh.bin") },
      { name: "deck.inp", direction: "upload", key: run("deck.inp") },
      { name: "solver.log", direction: "upload", key: run("solver.log") },
      { name: "results.frd", direction: "upload", key: run("results.frd") },
      { name: "results.dat", direction: "upload", key: run("results.dat") },
      { name: "surface.bin", direction: "upload", key: run("surface.bin") },
      { name: "fields.bin", direction: "upload", key: run("fields.bin") },
      { name: "nodes.bin", direction: "upload", key: run("nodes.bin") },
    ];
  }
  if (job.type === "report" && target !== null && job.params !== null) {
    // The API built these params itself when the report was asked for (routes/reports.ts).
    const params = job.params as unknown as ReportJobParams;
    const run = params.run as unknown as RunView;
    return [
      { name: "topology.json", direction: "download", key: geometryKey(job.ownerId, run.spec.geometryId, "topology.json") },
      ...(run.files.includes("solver.log")
        ? [{ name: "solver.log", direction: "download", key: runKey(job.ownerId, target, "solver.log") } as const]
        : []),
      ...params.figures.map(
        (f) => ({ name: f.file, direction: "download", key: figureKey(job.ownerId, target, f.kind, f.item) }) as const,
      ),
      ...(params.logo === null ? [] : [{ name: "logo", direction: "download", key: logoKey(job.ownerId) } as const]),
      { name: "report.docx", direction: "upload", key: reportKey(job.ownerId, target, job.id, "docx") },
      { name: "report.pdf", direction: "upload", key: reportKey(job.ownerId, target, job.id, "pdf") },
    ];
  }
  return [];
}

/** How long a presigned URL stays valid past the job's stop limit: uploads come after the solve. */
export const PRESIGN_MARGIN_SECONDS = 60 * 60;

/** Validity for a job with no stop limit (import, mesh, report): longer than any of them runs. */
export const PRESIGN_DEFAULT_SECONDS = 24 * 60 * 60;

/** The signer for presigned R2 URLs, or null when the API is not configured for them (`make dev`). */
export function r2Signer(env: Env): R2Signer | null {
  const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_BUCKET } = env;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ACCOUNT_ID || !R2_BUCKET) return null;
  return {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    bucket: R2_BUCKET,
    region: "auto",
  };
}

/** Seconds a claimed job's presigned URLs stay valid: its stop limit plus the margin (ADR-098). */
export function presignSeconds(job: Job): number {
  return job.stopAfterSeconds === null ? PRESIGN_DEFAULT_SECONDS : job.stopAfterSeconds + PRESIGN_MARGIN_SECONDS;
}

/**
 * Transfer URLs for a claimed job. In production they are presigned R2 URLs, so files of up
 * to 5 GiB go straight between the worker and R2, past Cloudflare's 100 MB request limit
 * (ADR-095 item 4). Without R2 credentials, as under `make dev`, they point at the API's own
 * pass-through routes, which check the worker token and that this worker holds the job. The
 * worker only follows the URLs, so it works with either.
 */
export async function transfers(job: Job, workerId: string, origin: string, env: Env): Promise<Transfer[]> {
  const signer = r2Signer(env);
  return Promise.all(
    jobFiles(job).map(async (file) => ({
      name: file.name,
      direction: file.direction,
      url:
        signer === null
          ? `${origin}/internal/jobs/${encodeURIComponent(job.id)}/files/${encodeURIComponent(
              file.name,
            )}?worker=${encodeURIComponent(workerId)}`
          : await presignUrl(signer, file.direction === "upload" ? "PUT" : "GET", file.key, presignSeconds(job)),
    })),
  );
}
