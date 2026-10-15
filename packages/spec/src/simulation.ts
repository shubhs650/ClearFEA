// SPDX-License-Identifier: AGPL-3.0-or-later
// Checks on a SimulationSpec that its JSON Schema cannot express (ADR-026): units of the right
// kind, positive sizes, unique ids, references between items, and tags that exist in the
// geometry. A spec that passes may still be incomplete; what is missing for a run is
// pre-run validation's job (preRunProblems in prerun.ts, M1.12).

import type {
  ElementOrder,
  IsotropicMaterial,
  LocalMeshScope,
  LocalSizeParams,
  Load,
  Quantity,
  SimulationSpec,
} from "./generated/simulation";
import { unitsTable } from "./units";

/**
 * The bodies, faces and edges of a geometry, as topology.json lists them (a face's type when
 * known). Edges are absent for geometries imported before M2.8.
 */
export interface TopologyTags {
  bodies: readonly { tag: number }[];
  faces: readonly { tag: number; type?: string }[];
  edges?: readonly { tag: number }[];
}

/** The kind of a support as the setup and its messages name it. */
export const supportKinds = {
  fixed: "Fixed support",
  displacement: "Prescribed displacement",
  frictionless: "Frictionless support",
  elastic: "Elastic support",
} as const;

/** The global components of a prescribed displacement, a force, gravity or a point. */
export const displacementAxes = ["x", "y", "z"] as const;

/** The kind of a load as the setup and its messages name it. */
export const loadKinds = {
  pressure: "Pressure",
  force: "Force",
  remote: "Remote load",
  hydrostatic: "Hydrostatic pressure",
  gravity: "Gravity",
  centrifugal: "Centrifugal load",
  temperature: "Temperature change",
} as const;

/** What a local mesh size applies to, as the setup and its messages name it (M2.8). */
export const localScopes = {
  faces: { label: "Faces", one: "face", many: "faces" },
  edges: { label: "Edges", one: "edge", many: "edges" },
  bodies: { label: "Bodies", one: "body", many: "bodies" },
} as const satisfies Record<LocalMeshScope, { label: string; one: string; many: string }>;

/** The element order of meshes made for the spec: 2 unless set (specs saved before M2.8 have none). */
export function elementOrder(spec: SimulationSpec): ElementOrder {
  return spec.mesh.order ?? 2;
}

/**
 * The local sizes a mesh for the spec is made with: each complete one (tags picked and a size
 * entered), tags sorted. Names and ids do not change a mesh, so they are left out.
 */
export function localSizeParams(spec: SimulationSpec): LocalSizeParams[] {
  return (spec.mesh.local ?? []).flatMap((item) =>
    item.size === null || item.tags.length === 0
      ? []
      : [{ scope: item.scope, tags: [...item.tags].sort((a, b) => a - b), size: { ...item.size } }],
  );
}

function sameSize(a: Quantity | null, b: Quantity | null): boolean {
  return a === null || b === null ? a === b : a.value === b.value && a.unit === b.unit;
}

/**
 * True when a mesh made with these settings is the one the spec asks for: the same global size,
 * order and local sizes, as entered (a size typed in another unit is another mesh).
 */
export function sameMeshSettings(
  spec: SimulationSpec,
  mesh: { size: Quantity; order: ElementOrder; local: readonly LocalSizeParams[] },
): boolean {
  const local = localSizeParams(spec);
  return (
    sameSize(spec.mesh.size, mesh.size) &&
    elementOrder(spec) === mesh.order &&
    local.length === mesh.local.length &&
    local.every((item, k) => {
      const other = mesh.local[k];
      return (
        other !== undefined &&
        item.scope === other.scope &&
        sameSize(item.size, other.size) &&
        item.tags.length === other.tags.length &&
        item.tags.every((tag, i) => tag === other.tags[i])
      );
    })
  );
}

/** True when the load acts on faces the user picks (gravity, centrifugal and temperature act on every body). */
export function loadHasFaces(load: Load): load is Extract<Load, { faces: number[] }> {
  return load.type === "pressure" || load.type === "force" || load.type === "remote" || load.type === "hydrostatic";
}

/** True when the setup has a gravity or centrifugal load, which need every material's density. */
export function hasBodyLoad(spec: SimulationSpec): boolean {
  return spec.loads.some((l) => l.type === "gravity" || l.type === "centrifugal");
}

/** True when the setup has a temperature change, which needs every material's thermal expansion. */
export function hasTemperatureChange(spec: SimulationSpec): boolean {
  return spec.loads.some((l) => l.type === "temperature");
}

/** A new, empty spec for a geometry: every body listed, nothing else set. */
export function emptySimulationSpec(geometryId: string, topology: TopologyTags): SimulationSpec {
  return {
    version: 1,
    analysis: "linear_static",
    geometryId,
    bodies: topology.bodies.map((body) => ({ tag: body.tag, material: null })),
    materials: [],
    supports: [],
    loads: [],
    mesh: { size: null, order: 2, local: [] },
  };
}

/** Each quantity kind a spec field uses, as a message names it ("not a length unit"). */
const kindNames = {
  length: "a length",
  pressure: "a pressure",
  force: "a force",
  moment: "a moment",
  density: "a density",
  acceleration: "an acceleration",
  angularVelocity: "an angular velocity",
  foundationStiffness: "a foundation stiffness",
  temperatureDifference: "a temperature difference",
  thermalExpansion: "a thermal expansion",
} as const;

function unitProblem(
  quantity: Quantity | null,
  kind: keyof typeof kindNames,
  what: string,
  positive: boolean,
): string | null {
  if (quantity === null) return null;
  const units = unitsTable.kinds[kind]?.units ?? {};
  if (!Object.hasOwn(units, quantity.unit)) {
    return `${what} is given in "${quantity.unit}", which is not ${kindNames[kind]} unit. Use one of: ${Object.keys(units).join(", ")}.`;
  }
  if (positive && !(quantity.value > 0)) {
    return `${what} must be greater than zero; it is ${quantity.value} ${quantity.unit}.`;
  }
  return null;
}

function listTags(tags: readonly number[]): string {
  return tags.join(", ");
}

/**
 * What is wrong with a material's values (units of the wrong kind, a modulus or density of zero
 * or less), in plain language; empty when nothing is. Missing values are not wrong here.
 */
export function materialProblems(material: IsotropicMaterial): string[] {
  return [
    unitProblem(material.youngsModulus, "pressure", `Young's modulus of material "${material.name}"`, true),
    unitProblem(material.density ?? null, "density", `The density of material "${material.name}"`, true),
    unitProblem(material.thermalExpansion ?? null, "thermalExpansion", `The thermal expansion of material "${material.name}"`, false),
  ].filter((problem) => problem !== null);
}

/**
 * A problem with a spec and the item it belongs to: the id of a material, support or load,
 * "bodies" for the body list, "mesh" for the mesh settings.
 */
export interface SpecProblem {
  item: string;
  message: string;
}

/**
 * Problems that make a spec unusable, in plain language; an empty list when there are none.
 * With the geometry's topology, also checks that every body is listed once and that every
 * face tag exists.
 */
export function checkSimulationSpec(spec: SimulationSpec, topology?: TopologyTags): string[] {
  return simulationSpecProblems(spec, topology).map((problem) => problem.message);
}

/** The problems of checkSimulationSpec, each with the item it belongs to, so the setup tree can mark it. */
export function simulationSpecProblems(spec: SimulationSpec, topology?: TopologyTags): SpecProblem[] {
  const problems: SpecProblem[] = [];
  const add = (item: string, problem: string | null) => {
    if (problem !== null) problems.push({ item, message: problem });
  };

  const ids = new Set<string>();
  const items: { id: string; label: string }[] = [
    ...spec.materials.map((m) => ({ id: m.id, label: `material "${m.name}"` })),
    ...spec.supports.map((s) => ({ id: s.id, label: `support "${s.name}"` })),
    ...spec.loads.map((l) => ({ id: l.id, label: `load "${l.name}"` })),
    ...(spec.mesh.local ?? []).map((l) => ({ id: l.id, label: `local mesh size "${l.name}"` })),
  ];
  for (const entry of items) {
    if (ids.has(entry.id)) add(entry.id, `The id "${entry.id}" of ${entry.label} is used by another item; ids must be unique.`);
    ids.add(entry.id);
  }

  const materialIds = new Set(spec.materials.map((m) => m.id));
  const bodyTags = new Set<number>();
  for (const body of spec.bodies) {
    if (bodyTags.has(body.tag)) add("bodies", `Body ${body.tag} is listed more than once.`);
    bodyTags.add(body.tag);
    if (body.material !== null && !materialIds.has(body.material)) {
      add("bodies", `Body ${body.tag} is assigned material "${body.material}", which is not in the simulation's materials.`);
    }
  }

  for (const material of spec.materials) {
    for (const problem of materialProblems(material)) add(material.id, problem);
  }
  for (const support of spec.supports) {
    if (support.type === "elastic") {
      add(support.id, unitProblem(support.stiffness, "foundationStiffness", `The stiffness of support "${support.name}"`, true));
    }
    if (support.type !== "displacement") continue;
    for (const axis of displacementAxes) {
      const component = support[axis];
      if (component === "free") continue;
      add(support.id, unitProblem(component, "length", `The ${axis} component of support "${support.name}"`, false));
    }
  }
  let centrifugal = 0;
  let temperature = 0;
  for (const load of spec.loads) {
    if (load.type === "pressure") {
      add(load.id, unitProblem(load.magnitude, "pressure", `The magnitude of load "${load.name}"`, false));
    } else if (load.type === "force" || load.type === "gravity") {
      const kind = load.type === "force" ? "force" : "acceleration";
      for (const axis of displacementAxes) {
        add(load.id, unitProblem(load[axis], kind, `The ${axis} component of load "${load.name}"`, false));
      }
    } else if (load.type === "remote") {
      for (const axis of displacementAxes) {
        add(load.id, unitProblem(load.point[axis], "length", `The ${axis} coordinate of the reference point of load "${load.name}"`, false));
        add(load.id, unitProblem(load.force[axis], "force", `The ${axis} component of the force of load "${load.name}"`, false));
        add(load.id, unitProblem(load.moment[axis], "moment", `The ${axis} component of the moment of load "${load.name}"`, false));
      }
    } else if (load.type === "hydrostatic") {
      add(load.id, unitProblem(load.fluidDensity, "density", `The fluid density of load "${load.name}"`, true));
      for (const axis of displacementAxes) {
        add(load.id, unitProblem(load.gravity[axis], "acceleration", `The ${axis} component of the gravity of load "${load.name}"`, false));
        add(load.id, unitProblem(load.freeSurface[axis], "length", `The ${axis} coordinate of the free-surface point of load "${load.name}"`, false));
      }
      if (displacementAxes.every((axis) => load.gravity[axis]?.value === 0)) {
        add(load.id, `The gravity of load "${load.name}" is zero, so the fluid has no depth. Enter it, for example z = -1 g.`);
      }
    } else if (load.type === "temperature") {
      add(load.id, unitProblem(load.change, "temperatureDifference", `The temperature change of load "${load.name}"`, false));
      // One uniform temperature field per setup (ADR-044).
      temperature += 1;
      if (temperature === 2) {
        add(load.id, `Load "${load.name}" is a second temperature change. A setup can have one; delete the other.`);
      }
    } else {
      add(load.id, unitProblem(load.angularVelocity, "angularVelocity", `The angular velocity of load "${load.name}"`, false));
      for (const axis of displacementAxes) {
        add(load.id, unitProblem(load.axisPoint[axis], "length", `The ${axis} coordinate of the axis point of load "${load.name}"`, false));
      }
      const d = load.axisDirection;
      if (displacementAxes.every((axis) => d[axis] === 0)) {
        add(load.id, `The axis direction of load "${load.name}" is zero. Give the axis a direction, for example z = 1.`);
      }
      // CalculiX takes one centrifugal load per body (ADR-040).
      centrifugal += 1;
      if (centrifugal === 2) {
        add(load.id, `Load "${load.name}" is a second centrifugal load. A setup can have one; delete the other.`);
      }
    }
  }
  add("mesh", unitProblem(spec.mesh.size, "length", "The global mesh size", true));
  for (const item of spec.mesh.local ?? []) {
    add(item.id, unitProblem(item.size, "length", `The size of local mesh size "${item.name}"`, true));
    const repeated = item.tags.filter((tag, k) => item.tags.indexOf(tag) !== k);
    if (repeated.length > 0) {
      add(item.id, `Local mesh size "${item.name}" lists ${localScopes[item.scope].one} ${listTags(repeated)} more than once.`);
    }
  }

  if (topology !== undefined) {
    const known = new Set(topology.bodies.map((b) => b.tag));
    const unknownBodies = [...bodyTags].filter((tag) => !known.has(tag));
    const missingBodies = [...known].filter((tag) => !bodyTags.has(tag));
    if (unknownBodies.length > 0) add("bodies", `The geometry has no body ${listTags(unknownBodies)}.`);
    if (missingBodies.length > 0) add("bodies", `Body ${listTags(missingBodies)} of the geometry is not listed in bodies.`);

    const faces = new Set(topology.faces.map((f) => f.tag));
    const faceItems = [
      ...spec.supports.map((s) => ({ id: s.id, faces: s.faces, label: `Support "${s.name}"` })),
      ...spec.loads.filter(loadHasFaces).map((l) => ({ id: l.id, faces: l.faces, label: `Load "${l.name}"` })),
    ];
    for (const entry of faceItems) {
      const unknown = entry.faces.filter((tag) => !faces.has(tag));
      if (unknown.length > 0) {
        add(entry.id, `${entry.label} uses face ${listTags(unknown)}, which the geometry does not have.`);
      }
    }
    const tagsOf: Record<LocalMeshScope, ReadonlySet<number> | undefined> = {
      faces,
      bodies: known,
      edges: topology.edges === undefined ? undefined : new Set(topology.edges.map((e) => e.tag)),
    };
    for (const item of spec.mesh.local ?? []) {
      const tags = tagsOf[item.scope];
      if (tags === undefined) {
        if (item.tags.length > 0) {
          add(
            item.id,
            `Local mesh size "${item.name}" uses edges, but this geometry was imported before edges could be picked. Upload the STEP file again to size its edges.`,
          );
        }
        continue;
      }
      const unknown = item.tags.filter((tag) => !tags.has(tag));
      if (unknown.length > 0) {
        add(
          item.id,
          `Local mesh size "${item.name}" uses ${localScopes[item.scope].one} ${listTags(unknown)}, which the geometry does not have.`,
        );
      }
    }
    // A frictionless support holds flat faces only (DECISIONS.md); the deck generator checks
    // the mesh again.
    const type = new Map(topology.faces.map((f) => [f.tag, f.type]));
    for (const support of spec.supports) {
      if (support.type !== "frictionless") continue;
      const curved = support.faces.filter((tag) => type.get(tag) !== undefined && type.get(tag) !== "plane");
      if (curved.length > 0) {
        const which = curved.length === 1 ? `face ${curved[0]}, which is` : `faces ${listTags(curved)}, which are`;
        add(
          support.id,
          `Frictionless support "${support.name}" uses ${which} not flat. It holds flat faces only; use a fixed support or a prescribed displacement on curved faces.`,
        );
      }
    }
  }
  return problems;
}
