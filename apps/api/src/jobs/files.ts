// SPDX-License-Identifier: AGPL-3.0-or-later
// The files each job type reads and writes (ADR-005). The worker sees only names and the
// transfer URLs built from them; which storage key a name maps to is decided here.

import type { Transfer } from "@clearfea/spec";
import { type GeometryFile, geometryKey } from "../db/geometries";
import type { Job } from "../db/jobs";
import { type MeshFile, meshKey } from "../db/meshes";

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
