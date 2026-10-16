// SPDX-License-Identifier: AGPL-3.0-or-later
// The Run panel's export of a succeeded run (M3.8, ADR-057): the results at every node and the
// reactions as CSV in the units the result is shown in, and the mesh with every field as a VTK
// file in SI for ParaView and similar tools. Built in the browser from the run's stored files
// (src/viewer/resultExport.ts), so every run solved since M3.4 can be exported without a rerun.

import type { RunView, SolveResult } from "@clearfea/spec";
import { useState } from "react";
import { fetchRunMesh, fetchRunNodes } from "../api/runs";
import { type ExportUnits, nodeCsvChunks, reactionsCsv, vtuParts } from "../viewer/resultExport";
import { parseResultFields } from "../viewer/resultFields";
import { parseVolumeMesh } from "../viewer/section";

type Kind = "nodes" | "reactions" | "vtk";

/** Saves Blob parts as a file through a temporary link. */
function save(parts: BlobPart[], type: string, name: string): void {
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Let the browser start the download before the data goes.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The run's mesh and its values at every node, or the problem in plain words. */
async function meshAndNodes(runId: string) {
  const [mesh, nodes] = await Promise.all([fetchRunMesh(runId), fetchRunNodes(runId)]);
  if (mesh.kind !== "ok") throw new Error(mesh.problem);
  if (nodes.kind !== "ok") throw new Error(nodes.problem);
  return { mesh: parseVolumeMesh(mesh.value), nodes: parseResultFields(nodes.value) };
}

export function RunExport({ run, result, units }: { run: RunView; result: SolveResult; units: ExportUnits }) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const hasNodes = run.files.includes("nodes.bin");
  const base = `clearfea-run-${run.id.slice(0, 8)}`;

  const start = (kind: Kind) => {
    setBusy(kind);
    setProblem(null);
    const work = async () => {
      if (kind === "reactions") {
        save([reactionsCsv(result, run.spec, units)], "text/csv;charset=utf-8", `${base}-reactions.csv`);
        return;
      }
      const { mesh, nodes } = await meshAndNodes(run.id);
      if (kind === "vtk") {
        save(vtuParts(mesh, nodes), "application/octet-stream", `${base}.vtu`);
        return;
      }
      // A large model takes many seconds to write as text: let the page redraw between chunks.
      const chunks: string[] = [];
      for (const chunk of nodeCsvChunks(mesh, nodes, units)) {
        chunks.push(chunk);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      save(chunks, "text/csv;charset=utf-8", `${base}-nodes.csv`);
    };
    work()
      .catch((error: unknown) => setProblem(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(null));
  };

  const button = (kind: Kind, label: string, disabled = false) => (
    <button type="button" onClick={() => start(kind)} disabled={busy !== null || disabled}>
      {busy === kind ? "Preparing…" : label}
    </button>
  );

  return (
    <section aria-label="Export">
      <h3 className="pane-subtitle">Export</h3>
      <div className="export-buttons">
        {button("nodes", "Results at every node (CSV)", !hasNodes)}
        {button("reactions", "Reactions and loads (CSV)")}
        {button("vtk", "Mesh and results (VTK)", !hasNodes)}
      </div>
      <p className="field-hint">
        {hasNodes
          ? "CSV files are in the units shown above, one row per mesh node numbered as in the solver input. The VTK file (.vtu) holds the undeformed mesh and every result at its nodes in SI units (m, Pa, m/m); warp by displacement to see the deformed shape."
          : "This run was solved before node values were kept, so only the reactions can be exported. Run again to export the results at every node."}
      </p>
      {problem !== null && (
        <p className="form-problem" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
