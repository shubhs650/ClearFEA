// SPDX-License-Identifier: AGPL-3.0-or-later
// The signed-in user's simulations and their SimulationSpec (M1.4, ADR-026).
// Shapes: packages/spec/schemas/simulation.schema.json.

import {
  type CreateRunRequest,
  type CreateSimulationRequest,
  checkSimulationSpec,
  elementLimitProblem,
  elementOrder,
  type EstimateResponse,
  localScopes,
  localSizeParams,
  type MeshResponse,
  preRunProblems,
  type RunListResponse,
  AnalysisTypeValues,
  type AnalysisType,
  MAX_MODES,
  type RunEstimate,
  type RunKind,
  runSolverProblem,
  type RunResponse,
  type SimulationMeshResponse,
  emptySimulationSpec,
  type SimulationListResponse,
  type SimulationResponse,
  type SimulationSpec,
  type SimulationView,
  type Solver,
  SolverValues,
  specRunKind,
  specSolver,
  type ViewListResponse,
  defaultReportOptions,
  isUnitSystem,
  unitsTable,
  orderedReportOptions,
  type ReportOptionsResponse,
  validateReportOptions,
  type ViewResponse,
  sameMeshSettings,
  specBonds,
  type Topology,
  validateCreateRunRequest,
  validateCreateSimulationRequest,
  validateSaveViewRequest,
  validateSimulationSpec,
  validateTopology,
} from "@clearfea/spec";
import { Hono } from "hono";
import { estimateRun, runSize } from "../billing/estimate";
import { readBody } from "../body";
import { type Geometry, geometryKey, getGeometry } from "../db/geometries";
import {
  createMesh,
  findReusableMesh,
  linkMesh,
  type Mesh,
  type MeshRequest,
  meshSettingsHash,
  simulationMesh,
} from "../db/meshes";
import { listMachineSizes } from "../db/machines";
import { createRun, listRuns } from "../db/runs";
import {
  createSimulation,
  getSimulation,
  listSimulations,
  type Simulation,
  saveSpec,
} from "../db/simulations";
import { userProject } from "../db/projects";
import { getReportOptions, saveReportOptions } from "../db/report";
import { deleteView, listViews, saveView } from "../db/views";
import type { Env } from "../env";
import { requireUser, type SessionEnv } from "../session";
import { meshView } from "./meshes";
import { projectUnitSystem } from "./projects";
import { runView } from "./runs";

export const simulations = new Hono<SessionEnv>();

simulations.use("*", requireUser);

const NOT_FOUND = "There is no simulation with that id in your account.";

function view(simulation: Simulation): SimulationView {
  return {
    id: simulation.id,
    name: simulation.name,
    geometryId: simulation.geometryId,
    spec: simulation.spec,
    createdAt: simulation.createdAt,
    updatedAt: simulation.updatedAt,
  };
}

/** The geometry's topology.json, or a plain-language reason it cannot be read. */
async function topologyOf(
  env: Env,
  userId: string,
  geometry: Geometry,
): Promise<{ topology: Topology } | { error: string }> {
  const object = await env.FILES.get(geometryKey(userId, geometry.id, "topology.json"));
  const checked = object === null ? null : validateTopology(await object.json());
  if (checked === null || !checked.ok) {
    return {
      error: "The topology of this geometry is missing or unreadable. Upload the file again.",
    };
  }
  return { topology: checked.value };
}

/** Problems with a spec for this geometry, joined into one message; null when there are none. */
function specProblem(spec: SimulationSpec, topology: Topology): string | null {
  const problems = checkSimulationSpec(spec, topology);
  return problems.length === 0 ? null : `The setup cannot be saved: ${problems.join(" ")}`;
}

simulations.post("/", async (c) => {
  const body = await readBody(
    c.req.raw,
    validateCreateSimulationRequest,
    "CreateSimulationRequest",
    "simulation.schema.json",
  );
  if ("error" in body) return c.json({ error: body.error }, 400);
  const request: CreateSimulationRequest = body.value;
  const geometry = await getGeometry(c.env.DB, c.var.userId, request.geometryId);
  if (geometry === null) {
    return c.json({ error: "There is no geometry with that id in your account." }, 404);
  }
  if (geometry.status !== "ready") {
    const why =
      geometry.status === "failed"
        ? "The geometry's import failed, so it cannot be simulated. Upload the file again."
        : "Confirm the geometry's length unit before creating a simulation on it.";
    return c.json({ error: why }, 409);
  }
  if (request.spec !== undefined && request.spec.geometryId !== geometry.id) {
    return c.json({ error: "The spec's geometryId must be the geometry the simulation is created on." }, 400);
  }
  const read = await topologyOf(c.env, c.var.userId, geometry);
  if ("error" in read) return c.json({ error: read.error }, 500);
  const spec = request.spec ?? emptySimulationSpec(geometry.id, read.topology);
  const problem = specProblem(spec, read.topology);
  if (problem !== null) return c.json({ error: problem }, 400);
  const created = await createSimulation(c.env.DB, c.var.userId, {
    id: crypto.randomUUID(),
    name: request.name,
    spec,
  });
  if (created === null) {
    return c.json({ error: "The geometry's unit was changed meanwhile. Confirm it and try again." }, 409);
  }
  return c.json({ simulation: view(created) } satisfies SimulationResponse, 201);
});

simulations.get("/", async (c) => {
  const geometryId = c.req.query("geometryId");
  const list = await listSimulations(c.env.DB, c.var.userId, geometryId === undefined ? {} : { geometryId });
  return c.json({ simulations: list.map(view) } satisfies SimulationListResponse);
});

simulations.get("/:id", async (c) => {
  const simulation = await getSimulation(c.env.DB, c.var.userId, c.req.param("id"));
  // Another user's simulation answers exactly like a missing one, so ids reveal nothing.
  if (simulation === null) return c.json({ error: NOT_FOUND }, 404);
  return c.json({ simulation: view(simulation) } satisfies SimulationResponse);
});

simulations.put("/:id/spec", async (c) => {
  const body = await readBody(c.req.raw, validateSimulationSpec, "SimulationSpec", "simulation.schema.json");
  if ("error" in body) return c.json({ error: body.error }, 400);
  const spec = body.value;
  const simulation = await getSimulation(c.env.DB, c.var.userId, c.req.param("id"));
  if (simulation === null) return c.json({ error: NOT_FOUND }, 404);
  if (spec.geometryId !== simulation.geometryId) {
    return c.json(
      { error: "A simulation stays on the geometry it was created on; the spec's geometryId cannot change." },
      400,
    );
  }
  const geometry = await getGeometry(c.env.DB, c.var.userId, simulation.geometryId);
  if (geometry === null) throw new Error("A simulation's geometry disappeared.");
  const read = await topologyOf(c.env, c.var.userId, geometry);
  if ("error" in read) return c.json({ error: read.error }, 500);
  const problem = specProblem(spec, read.topology);
  if (problem !== null) return c.json({ error: problem }, 400);
  const saved = await saveSpec(c.env.DB, c.var.userId, simulation.id, spec);
  if (saved === null) return c.json({ error: NOT_FOUND }, 404);
  return c.json({ simulation: view(saved) } satisfies SimulationResponse);
});

simulations.get("/:id/mesh", async (c) => {
  const simulation = await getSimulation(c.env.DB, c.var.userId, c.req.param("id"));
  if (simulation === null) return c.json({ error: NOT_FOUND }, 404);
  const mesh = await simulationMesh(c.env.DB, c.var.userId, simulation.id);
  return c.json({ mesh: mesh === null ? null : meshView(mesh) } satisfies SimulationMeshResponse);
});

/**
 * Meshes the simulation's geometry with the mesh settings of its saved spec: global size (M1.6,
 * ADR-028), element order and local sizes (M2.8, ADR-045). When the user already has a ready or
 * still-meshing mesh of the same geometry, scaling and settings, that mesh becomes the
 * simulation's mesh instead (M2.10, ADR-047).
 */
simulations.post("/:id/mesh", async (c) => {
  const simulation = await getSimulation(c.env.DB, c.var.userId, c.req.param("id"));
  if (simulation === null) return c.json({ error: NOT_FOUND }, 404);
  const size = simulation.spec.mesh.size;
  if (size === null) {
    return c.json({ error: "Enter a global mesh size in the Mesh settings, then generate the mesh." }, 409);
  }
  // An unfinished local size would be left out of the mesh without the user knowing.
  const unfinished = (simulation.spec.mesh.local ?? []).find((l) => l.size === null || l.tags.length === 0);
  if (unfinished !== undefined) {
    const { many } = localScopes[unfinished.scope];
    return c.json(
      {
        error: `Local mesh size "${unfinished.name}" is not finished. Give it ${many} and a size, or delete it, then generate the mesh.`,
      },
      409,
    );
  }
  const current = await simulationMesh(c.env.DB, c.var.userId, simulation.id);
  if (current?.status === "meshing") {
    return c.json({ error: "The mesh is already being made. Wait for it to finish, then try again." }, 409);
  }
  const geometry = await getGeometry(c.env.DB, c.var.userId, simulation.geometryId);
  if (geometry === null) throw new Error("A simulation's geometry disappeared.");
  if (geometry.status !== "ready" || geometry.scaling === null) {
    return c.json({ error: "Confirm the geometry's length unit before meshing it." }, 409);
  }
  const request: MeshRequest = {
    geometryId: geometry.id,
    scaling: geometry.scaling,
    size,
    order: elementOrder(simulation.spec),
    local: localSizeParams(simulation.spec),
  };
  const hash = await meshSettingsHash(request);
  // A mesh with the same settings is reused: no job is queued and nothing is charged (ADR-047).
  const existing = await findReusableMesh(c.env.DB, c.var.userId, hash);
  const reuse =
    existing !== null &&
    (existing.id === current?.id || (await linkMesh(c.env.DB, c.var.userId, simulation.id, existing.id)));
  if (reuse) {
    return c.json({ mesh: meshView(existing), reused: true } satisfies MeshResponse, 200);
  }
  const { mesh } = await createMesh(c.env.DB, c.var.userId, { ...request, simulationId: simulation.id, hash });
  return c.json({ mesh: meshView(mesh), reused: false } satisfies MeshResponse, 201);
});

simulations.get("/:id/runs", async (c) => {
  const simulation = await getSimulation(c.env.DB, c.var.userId, c.req.param("id"));
  if (simulation === null) return c.json({ error: NOT_FOUND }, 404);
  const list = await listRuns(c.env.DB, c.var.userId, simulation.id);
  return c.json({ runs: list.map(runView) } satisfies RunListResponse);
});

/**
 * The simulation's current mesh when a run can be solved on it: ready, and made with the saved
 * spec's mesh settings. Otherwise what to do first, in plain language.
 */
async function runnableMesh(
  db: D1Database,
  userId: string,
  simulation: Simulation,
): Promise<{ mesh: Mesh } | { error: string }> {
  const mesh = await simulationMesh(db, userId, simulation.id);
  if (mesh === null || mesh.status === "failed") {
    return { error: "Generate the mesh in the Mesh settings, then run the simulation." };
  }
  if (mesh.status === "meshing") {
    return { error: "The mesh is still being made. Run the simulation when it has finished." };
  }
  if (!sameMeshSettings(simulation.spec, mesh)) {
    return { error: "The mesh settings changed after the mesh was made. Generate the mesh again, then run." };
  }
  return { mesh };
}

/**
 * The estimate for a ready mesh with a solver on every machine size (M2.12, ADR-049, ADR-063),
 * for a run of `kind` (M6.3); the solver must be one that solves such a run.
 */
async function meshEstimate(db: D1Database, mesh: Mesh, solver: Solver, kind: RunKind): Promise<RunEstimate> {
  if (mesh.nodeCount === null) throw new Error("A ready mesh has no node count.");
  return estimateRun(mesh.nodeCount, await listMachineSizes(db), solver, kind);
}

/**
 * Memory, time and cost estimated for solving the simulation on its current mesh, per machine
 * size, with the size recommended (M2.12, ADR-049). `?solver=` asks for another solver than
 * the saved spec's, so the setup can show the estimate of a choice before it is saved (ADR-063);
 * `?analysis=` and `?modes=` do the same for the analysis and a modal run's modes (M6.3).
 */
simulations.get("/:id/estimate", async (c) => {
  const asked = c.req.query("solver");
  if (asked !== undefined && !(SolverValues as readonly string[]).includes(asked)) {
    return c.json({ error: `There is no solver called ${asked}. Choose one of: ${SolverValues.join(", ")}.` }, 400);
  }
  const askedAnalysis = c.req.query("analysis");
  if (askedAnalysis !== undefined && !(AnalysisTypeValues as readonly string[]).includes(askedAnalysis)) {
    return c.json(
      { error: `There is no analysis called ${askedAnalysis}. Choose one of: ${AnalysisTypeValues.join(", ")}.` },
      400,
    );
  }
  const askedModes = c.req.query("modes");
  const modes = askedModes === undefined ? undefined : Number(askedModes);
  if (modes !== undefined && !(Number.isInteger(modes) && modes >= 1 && modes <= MAX_MODES)) {
    return c.json({ error: `The number of modes must be a whole number from 1 to ${MAX_MODES}, not ${askedModes}.` }, 400);
  }
  const simulation = await getSimulation(c.env.DB, c.var.userId, c.req.param("id"));
  if (simulation === null) return c.json({ error: NOT_FOUND }, 404);
  const found = await runnableMesh(c.env.DB, c.var.userId, simulation);
  if ("error" in found) return c.json({ error: found.error }, 409);
  const solver = (asked as Solver | undefined) ?? specSolver(simulation.spec);
  const kind = specRunKind({
    analysis: (askedAnalysis as AnalysisType | undefined) ?? simulation.spec.analysis,
    modes: modes ?? simulation.spec.modes,
  });
  const cannot = runSolverProblem(solver, kind);
  if (cannot !== null) return c.json({ error: cannot }, 409);
  return c.json({ estimate: await meshEstimate(c.env.DB, found.mesh, solver, kind) } satisfies EstimateResponse);
});

/**
 * Solves the simulation's saved spec on its current mesh (M1.8, ADR-030). The run keeps a copy
 * of the spec as it is now; later edits to the simulation never change it. A setup that pre-run
 * validation (M1.12, ADR-034) finds incomplete is refused here, so no job is queued or charged;
 * the deck generator still refuses anything that slips past. The run goes on the machine size
 * the body names, or on the recommended one, and keeps the estimate made now (M2.12, ADR-049).
 * The run's copy lists every bond of the geometry, so a spec saved before M4.2 is tied the way
 * the setup shows it (every candidate detected, ADR-059); the deck ties what the list says (M4.3).
 * A mesh with more elements than the spec's solver may solve on a 16 GB machine is refused
 * before any machine is used (ADR-063).
 */
simulations.post("/:id/runs", async (c) => {
  let request: CreateRunRequest = {};
  // An empty body asks for the recommended size.
  if ((await c.req.raw.clone().text()) !== "") {
    const body = await readBody(c.req.raw, validateCreateRunRequest, "CreateRunRequest", "simulation.schema.json");
    if ("error" in body) return c.json({ error: body.error }, 400);
    request = body.value;
  }
  const simulation = await getSimulation(c.env.DB, c.var.userId, c.req.param("id"));
  if (simulation === null) return c.json({ error: NOT_FOUND }, 404);
  const geometry = await getGeometry(c.env.DB, c.var.userId, simulation.geometryId);
  if (geometry === null) throw new Error("A simulation's geometry disappeared.");
  const read = await topologyOf(c.env, c.var.userId, geometry);
  if ("error" in read) return c.json({ error: read.error }, 500);
  const problems = preRunProblems(simulation.spec, read.topology);
  if (problems.length > 0) {
    const list = problems.map((p) => p.message).join(" ");
    return c.json({ error: `The setup is not ready to run. ${list}` }, 409);
  }
  const found = await runnableMesh(c.env.DB, c.var.userId, simulation);
  if ("error" in found) return c.json({ error: found.error }, 409);
  const { mesh } = found;
  const solver = specSolver(simulation.spec);
  if (mesh.elementCount === null) throw new Error("A ready mesh has no element count.");
  const kind = specRunKind(simulation.spec);
  // Pre-run validation refuses a solver that cannot solve the analysis; this is a backstop.
  const cannot = runSolverProblem(solver, kind);
  if (cannot !== null) return c.json({ error: cannot }, 409);
  const tooLarge = elementLimitProblem(solver, mesh.order, mesh.elementCount, kind);
  if (tooLarge !== null) return c.json({ error: tooLarge }, 409);
  const estimate = await meshEstimate(c.env.DB, mesh, solver, kind);
  const size = runSize(estimate, request.machineSize);
  if (size === undefined) {
    const names = estimate.sizes.map((s) => s.size).join(", ");
    return c.json({ error: `There is no machine size called ${request.machineSize}. Choose one of: ${names}.` }, 400);
  }
  const [latest] = await listRuns(c.env.DB, c.var.userId, simulation.id, 1);
  if (latest?.status === "solving") {
    return c.json({ error: "The simulation is already being solved. Wait for that run to finish." }, 409);
  }
  const created = await createRun(c.env.DB, c.var.userId, {
    simulationId: simulation.id,
    meshId: mesh.id,
    // The run's frozen spec always names its solver, so a later default cannot change what a
    // run says it was solved with (ADR-063).
    spec: { ...simulation.spec, solver, bonds: specBonds(simulation.spec, read.topology) },
    machineSize: size.size,
    estimate,
  });
  if (created === null) {
    return c.json({ error: "The mesh or the machine sizes changed meanwhile. Check the mesh, then run again." }, 409);
  }
  return c.json({ run: runView(created.run) } satisfies RunResponse, 201);
});

// Saved views (M3.6, ADR-055). Hidden bodies must be bodies of the simulation's geometry, which
// its spec lists, and at least one body stays shown.
simulations.get("/:id/views", async (c) => {
  const simulation = await getSimulation(c.env.DB, c.var.userId, c.req.param("id"));
  if (simulation === null) return c.json({ error: NOT_FOUND }, 404);
  const views = await listViews(c.env.DB, c.var.userId, simulation.id);
  return c.json({ views } satisfies ViewListResponse);
});

simulations.post("/:id/views", async (c) => {
  const body = await readBody(c.req.raw, validateSaveViewRequest, "SaveViewRequest", "view.schema.json");
  if ("error" in body) return c.json({ error: body.error }, 400);
  const simulation = await getSimulation(c.env.DB, c.var.userId, c.req.param("id"));
  if (simulation === null) return c.json({ error: NOT_FOUND }, 404);
  const { name, settings } = body.value;
  const bodies = new Set(simulation.spec.bodies.map((b) => b.tag));
  const unknown = settings.hiddenBodies.filter((tag) => !bodies.has(tag));
  if (unknown.length > 0) {
    return c.json({ error: `The geometry of this simulation has no body ${unknown.join(", ")}, so it cannot be hidden.` }, 400);
  }
  if (settings.hiddenBodies.length >= bodies.size) {
    return c.json({ error: "A view hides every body, so it would show nothing. Show at least one body and save it again." }, 400);
  }
  const saved = await saveView(c.env.DB, c.var.userId, simulation.id, name.trim(), settings);
  if (saved === null) return c.json({ error: NOT_FOUND }, 404);
  return c.json({ view: saved.view } satisfies ViewResponse, saved.created ? 201 : 200);
});

simulations.delete("/:id/views/:viewId", async (c) => {
  if (!(await deleteView(c.env.DB, c.var.userId, c.req.param("id"), c.req.param("viewId")))) {
    return c.json({ error: "There is no saved view with that id in this simulation." }, 404);
  }
  return c.body(null, 204);
});

// Report options (M7.1, ADR-074). Views must be saved views of the simulation; a view deleted
// later is left out of the answer, and the report draws only the views still there. The report's
// unit system (M7.6, ADR-076) starts as the project's; options saved before M7.6 have none, and a
// system units.json no longer lists is answered as the project's too.
async function reportOptionsView(
  db: D1Database,
  userId: string,
  simulation: Simulation,
): Promise<ReportOptionsResponse> {
  const [saved, views, project] = await Promise.all([
    getReportOptions(db, userId, simulation.id),
    listViews(db, userId, simulation.id),
    userProject(db, userId),
  ]);
  const projectSystem = projectUnitSystem(project);
  if (saved === null) {
    return { options: defaultReportOptions(simulation.name, projectSystem), saved: false, updatedAt: null };
  }
  const known = new Set(views.map((v) => v.id));
  const stored = saved.options.unitSystem as string | undefined;
  const options = {
    ...saved.options,
    views: saved.options.views.filter((id) => known.has(id)),
    unitSystem: stored !== undefined && isUnitSystem(stored) ? stored : projectSystem,
  };
  return { options, saved: true, updatedAt: saved.updatedAt };
}

simulations.get("/:id/report-options", async (c) => {
  const simulation = await getSimulation(c.env.DB, c.var.userId, c.req.param("id"));
  if (simulation === null) return c.json({ error: NOT_FOUND }, 404);
  return c.json(await reportOptionsView(c.env.DB, c.var.userId, simulation));
});

simulations.put("/:id/report-options", async (c) => {
  const body = await readBody(c.req.raw, validateReportOptions, "ReportOptions", "report.schema.json");
  if ("error" in body) return c.json({ error: body.error }, 400);
  const simulation = await getSimulation(c.env.DB, c.var.userId, c.req.param("id"));
  if (simulation === null) return c.json({ error: NOT_FOUND }, 404);
  if (!isUnitSystem(body.value.unitSystem)) {
    const systems = Object.keys(unitsTable.systems).join(", ");
    return c.json({ error: `'${body.value.unitSystem}' is not a unit system. Use one of: ${systems}.` }, 400);
  }
  const known = new Set((await listViews(c.env.DB, c.var.userId, simulation.id)).map((v) => v.id));
  const missing = body.value.views.filter((id) => !known.has(id));
  if (missing.length > 0) {
    return c.json(
      { error: "A view picked for the report is not a saved view of this simulation. Reload the views and pick again." },
      400,
    );
  }
  const saved = await saveReportOptions(c.env.DB, c.var.userId, simulation.id, orderedReportOptions(body.value));
  if (saved === null) return c.json({ error: NOT_FOUND }, 404);
  return c.json(await reportOptionsView(c.env.DB, c.var.userId, simulation));
});
