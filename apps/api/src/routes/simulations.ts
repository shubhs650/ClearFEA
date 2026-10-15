// SPDX-License-Identifier: AGPL-3.0-or-later
// The signed-in user's simulations and their SimulationSpec (M1.4, ADR-026).
// Shapes: packages/spec/schemas/simulation.schema.json.

import {
  type CreateSimulationRequest,
  checkSimulationSpec,
  elementOrder,
  localScopes,
  localSizeParams,
  type MeshResponse,
  preRunProblems,
  type RunListResponse,
  type RunResponse,
  type SimulationMeshResponse,
  emptySimulationSpec,
  type SimulationListResponse,
  type SimulationResponse,
  type SimulationSpec,
  type SimulationView,
  sameMeshSettings,
  type Topology,
  validateCreateSimulationRequest,
  validateSimulationSpec,
  validateTopology,
} from "@clearfea/spec";
import { Hono } from "hono";
import { readBody } from "../body";
import { type Geometry, geometryKey, getGeometry } from "../db/geometries";
import { createMesh, simulationMesh } from "../db/meshes";
import { createRun, listRuns } from "../db/runs";
import {
  createSimulation,
  getSimulation,
  listSimulations,
  type Simulation,
  saveSpec,
} from "../db/simulations";
import type { Env } from "../env";
import { requireUser, type SessionEnv } from "../session";
import { meshView } from "./meshes";
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
 * ADR-028), element order and local sizes (M2.8, ADR-045).
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
  const { mesh } = await createMesh(c.env.DB, c.var.userId, {
    simulationId: simulation.id,
    geometryId: geometry.id,
    scaling: geometry.scaling,
    size,
    order: elementOrder(simulation.spec),
    local: localSizeParams(simulation.spec),
  });
  return c.json({ mesh: meshView(mesh) } satisfies MeshResponse, 201);
});

simulations.get("/:id/runs", async (c) => {
  const simulation = await getSimulation(c.env.DB, c.var.userId, c.req.param("id"));
  if (simulation === null) return c.json({ error: NOT_FOUND }, 404);
  const list = await listRuns(c.env.DB, c.var.userId, simulation.id);
  return c.json({ runs: list.map(runView) } satisfies RunListResponse);
});

/**
 * Solves the simulation's saved spec on its current mesh (M1.8, ADR-030). The run keeps a copy
 * of the spec as it is now; later edits to the simulation never change it. A setup that pre-run
 * validation (M1.12, ADR-034) finds incomplete is refused here, so no job is queued or charged;
 * the deck generator still refuses anything that slips past.
 */
simulations.post("/:id/runs", async (c) => {
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
  const mesh = await simulationMesh(c.env.DB, c.var.userId, simulation.id);
  if (mesh === null || mesh.status === "failed") {
    return c.json({ error: "Generate the mesh in the Mesh settings, then run the simulation." }, 409);
  }
  if (mesh.status === "meshing") {
    return c.json({ error: "The mesh is still being made. Run the simulation when it has finished." }, 409);
  }
  if (!sameMeshSettings(simulation.spec, mesh)) {
    return c.json({ error: "The mesh settings changed after the mesh was made. Generate the mesh again, then run." }, 409);
  }
  const [latest] = await listRuns(c.env.DB, c.var.userId, simulation.id, 1);
  if (latest?.status === "solving") {
    return c.json({ error: "The simulation is already being solved. Wait for that run to finish." }, 409);
  }
  const created = await createRun(c.env.DB, c.var.userId, {
    simulationId: simulation.id,
    meshId: mesh.id,
    spec: simulation.spec,
  });
  if (created === null) {
    return c.json({ error: "The mesh changed meanwhile. Generate the mesh again, then run." }, 409);
  }
  return c.json({ run: runView(created.run) } satisfies RunResponse, 201);
});
