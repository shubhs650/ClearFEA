// SPDX-License-Identifier: AGPL-3.0-or-later
// A run's Word report (M7.3, ADR-077). Asking for one freezes everything it prints into a report
// job: the run's record, the simulation's saved report options, the user's company name and logo,
// the run's figures (drawn in the browser first, ADR-011) and the standing statements and notes
// filled from the run (ADR-073). The worker lays them out and stores report.docx under the job.
// Shapes: packages/spec/schemas/report.schema.json.

import {
  defaultReportOptions,
  isUnitSystem,
  type ReportJobParams,
  type RunReportResponse,
  runReportNotes,
  runReportStatements,
} from "@clearfea/spec";
import { Hono } from "hono";
import { getGeometry } from "../db/geometries";
import { getMesh } from "../db/meshes";
import { userProject } from "../db/projects";
import { getBranding, getReportOptions, listFigures } from "../db/report";
import { latestReportJob, queueReport, reportKey, reportView } from "../db/reports";
import type { Run } from "../db/runs";
import { getRun } from "../db/runs";
import { getSimulation } from "../db/simulations";
import { requireUser, type SessionEnv } from "../session";
import { projectUnitSystem } from "./projects";
import { runView } from "./runs";

export const reports = new Hono<SessionEnv>();

reports.use("*", requireUser);

const NOT_FOUND = "There is no run with that id in your account.";

/** The report's unit system: the one saved in its options (ADR-076), else the project's. */
function reportUnitSystem(saved: string | undefined, projectSystem: string): string {
  return saved !== undefined && isUnitSystem(saved) ? saved : projectSystem;
}

/** Everything the report job prints, frozen now so a later change to the setup cannot reach it. */
async function reportParams(db: D1Database, userId: string, run: Run): Promise<ReportJobParams | null> {
  const [simulation, geometry, mesh, project, branding, saved, figures] = await Promise.all([
    getSimulation(db, userId, run.simulationId),
    getGeometry(db, userId, run.spec.geometryId),
    getMesh(db, userId, run.meshId),
    userProject(db, userId),
    getBranding(db, userId),
    getReportOptions(db, userId, run.simulationId),
    listFigures(db, userId, run.id),
  ]);
  if (simulation === null || geometry === null) return null;
  const projectSystem = projectUnitSystem(project);
  const options = saved?.options ?? defaultReportOptions(simulation.name, projectSystem);
  const printed = new Set(options.sections);
  const shown = figures.filter((f) => (f.kind === "view" ? printed.has("results") : printed.has("loadsSupports")));
  return {
    runId: run.id,
    generatedAt: new Date().toISOString(),
    unitSystem: reportUnitSystem(options.unitSystem, projectSystem),
    sections: options.sections,
    titleBlock: options.titleBlock,
    companyName: branding.companyName,
    logo: branding.logo,
    projectName: project.name,
    simulationName: simulation.name,
    geometry: { name: geometry.name, unit: geometry.confirmedUnit },
    run: runView(run) as unknown as Record<string, unknown>,
    meshQuality: (mesh?.quality ?? null) as Record<string, unknown> | null,
    figures: shown.map((f, i) => ({
      file: `figure-${i}.png`,
      kind: f.kind,
      item: f.item,
      caption: f.caption,
      width: f.width,
      height: f.height,
    })),
    statements: runReportStatements(run),
    notes: runReportNotes(run.spec).map((n) => ({ id: n.id, title: n.title, text: n.text })),
  };
}

reports.get("/:id/report", async (c) => {
  const run = await getRun(c.env.DB, c.var.userId, c.req.param("id"));
  if (run === null) return c.json({ error: NOT_FOUND }, 404);
  const job = await latestReportJob(c.env.DB, c.var.userId, run.id);
  return c.json({ report: job === null ? null : reportView(job) } satisfies RunReportResponse);
});

/** Queues a report of a solved run, unless one is already being made. */
reports.post("/:id/report", async (c) => {
  const run = await getRun(c.env.DB, c.var.userId, c.req.param("id"));
  if (run === null) return c.json({ error: NOT_FOUND }, 404);
  if (run.status !== "succeeded") {
    return c.json(
      { error: "A report is made from a solved run, and this run has not succeeded. Run the simulation and try again." },
      409,
    );
  }
  const latest = await latestReportJob(c.env.DB, c.var.userId, run.id);
  if (latest !== null && ["queued", "making"].includes(reportView(latest).status)) {
    return c.json({ error: "A report of this run is already being made. Wait for it to finish." }, 409);
  }
  const params = await reportParams(c.env.DB, c.var.userId, run);
  if (params === null) return c.json({ error: "The run's simulation or geometry is no longer in your account." }, 409);
  const job = await queueReport(c.env.DB, c.var.userId, run.id, params);
  return c.json({ report: reportView(job) } satisfies RunReportResponse, 202);
});

/** The latest report's DOCX once it has been made. */
reports.get("/:id/report/docx", async (c) => {
  const run = await getRun(c.env.DB, c.var.userId, c.req.param("id"));
  if (run === null) return c.json({ error: NOT_FOUND }, 404);
  const job = await latestReportJob(c.env.DB, c.var.userId, run.id);
  if (job === null || job.status !== "succeeded") {
    return c.json({ error: "This run has no finished report. Make the report under Report first." }, 404);
  }
  const object = await c.env.FILES.get(reportKey(c.var.userId, run.id, job.id));
  if (object === null) return c.json({ error: "The report is missing from storage. Make it again." }, 500);
  return c.body(object.body, 200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "Content-Disposition": `attachment; filename="${reportFilename(job.params, run.id)}"`,
    "Content-Length": String(object.size),
    "X-Content-Type-Options": "nosniff",
  });
});

/** "CF-001 Block under pressure rev A.docx", from the title block, with only safe characters. */
export function reportFilename(params: Record<string, unknown> | null, runId: string): string {
  const block = (params as Partial<ReportJobParams> | null)?.titleBlock;
  const parts = [block?.documentNumber, block?.title, block?.revision ? `rev ${block.revision}` : ""];
  const name = parts
    .filter((p): p is string => !!p)
    .join(" ")
    .replace(/[^A-Za-z0-9 ._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${name || `clearfea-report-${runId.slice(0, 8)}`}.docx`;
}
