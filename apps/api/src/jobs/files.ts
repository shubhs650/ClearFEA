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
      { name: "report.docx", direction: "upload", key: reportKey(job.ownerId, target, job.id) },
    ];
  }
  return [];
}

/**
 * Transfer URLs for a claimed job. In Phase 0 they point at the API's own pass-through
 * routes, which check the worker token and that this worker holds the job; in the cloud
 * they become presigned R2 URLs and the worker code does not change.
 */
export function transfers(job: Job, workerId: string, origin: string): Transfer[] {
  return jobFiles(job).map((file) => ({
    name: file.name,
    direction: file.direction,
    url: `${origin}/internal/jobs/${encodeURIComponent(job.id)}/files/${encodeURIComponent(
      file.name,
    )}?worker=${encodeURIComponent(workerId)}`,
  }));
}
