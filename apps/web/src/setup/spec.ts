// SPDX-License-Identifier: AGPL-3.0-or-later
// Pure helpers for the setup tree (M1.5): adding, changing and removing SimulationSpec items,
// and the complete / incomplete / error mark of each tree item. The marks say what an item
// still needs in plain language; the full pre-run list beside the Run button is preRunProblems
// in packages/spec (M1.12).

import {
  displacementAxes,
  hasBodyLoad,
  type IsotropicMaterial,
  type Load,
  loadHasFaces,
  loadKinds,
  type MeshView,
  movesByDisplacement,
  type Quantity,
  type RunView,
  type SimulationSpec,
  type Support,
  simulationSpecProblems,
  supportKinds,
  type TopologyTags,
} from "@clearfea/spec";

/** The types of support the setup offers (M1.5 fixed; M2.2 prescribed displacement, frictionless). */
export type SupportType = Support["type"];

/**
 * The types of load the setup offers (M1.5 pressure; M2.3 force, gravity, centrifugal; M2.4 remote;
 * M2.5 hydrostatic).
 */
export type LoadType = Load["type"];

export type Mark = "complete" | "incomplete" | "error";

/** A tree item's mark and the reasons for it, worst first. */
export interface ItemStatus {
  mark: Mark;
  notes: string[];
}

/** The groups of the setup tree. Items are addressed by their spec id. */
export type Group = "materials" | "supports" | "loads";

const rank: Record<Mark, number> = { complete: 0, incomplete: 1, error: 2 };

function worst(statuses: readonly ItemStatus[]): ItemStatus {
  let mark: Mark = "complete";
  for (const status of statuses) if (rank[status.mark] > rank[mark]) mark = status.mark;
  return { mark, notes: statuses.filter((s) => s.mark === mark).flatMap((s) => s.notes) };
}

function status(errors: readonly string[], missing: readonly string[]): ItemStatus {
  if (errors.length > 0) return { mark: "error", notes: [...errors] };
  if (missing.length > 0) return { mark: "incomplete", notes: [...missing] };
  return { mark: "complete", notes: [] };
}

/** Marks for every item and group of the tree, keyed by item id or group name. */
export function setupStatus(spec: SimulationSpec, topology?: TopologyTags): Map<string, ItemStatus> {
  const errors = new Map<string, string[]>();
  for (const problem of simulationSpecProblems(spec, topology)) {
    errors.set(problem.item, [...(errors.get(problem.item) ?? []), problem.message]);
  }
  const errorsOf = (item: string) => errors.get(item) ?? [];
  const result = new Map<string, ItemStatus>();

  const bodyLoad = hasBodyLoad(spec);
  const materials = spec.materials.map((m) => {
    const missing: string[] = [];
    if (m.youngsModulus === null) missing.push("Enter Young's modulus.");
    if (m.poissonsRatio === null) missing.push("Enter Poisson's ratio.");
    if (bodyLoad && (m.density ?? null) === null) missing.push("Enter the density; gravity and centrifugal loads need it.");
    const s = status(errorsOf(m.id), missing);
    result.set(m.id, s);
    return s;
  });
  const unassigned = spec.bodies.filter((b) => b.material === null).map((b) => b.tag);
  const bodies = status(
    errorsOf("bodies"),
    [
      ...(spec.materials.length === 0 ? ["Add a material."] : []),
      ...(spec.materials.length > 0 && unassigned.length > 0
        ? [`Assign a material to body ${unassigned.join(", ")}.`]
        : []),
    ],
  );
  result.set("materials", worst([bodies, ...materials]));

  const supports = spec.supports.map((s) => {
    const missing: string[] = [];
    if (s.faces.length === 0) {
      missing.push({ fixed: "Pick the faces to fix.", displacement: "Pick the faces to move.", frictionless: "Pick the flat faces it holds." }[s.type]);
    }
    if (s.type === "displacement") {
      for (const axis of displacementAxes) {
        if (s[axis] === null) missing.push(`Enter the ${axis} displacement or set it free.`);
      }
      if (displacementAxes.every((axis) => s[axis] === "free")) {
        missing.push("Give at least one component a value; every one is free.");
      }
    }
    const item = status(errorsOf(s.id), missing);
    result.set(s.id, item);
    return item;
  });
  result.set("supports", worst([status([], spec.supports.length === 0 ? ["Add a support."] : []), ...supports]));

  const loads = spec.loads.map((l) => {
    const item = status(errorsOf(l.id), loadMissing(l));
    result.set(l.id, item);
    return item;
  });
  // A prescribed displacement other than zero loads the part by itself (ADR-039).
  const needsLoad = spec.loads.length === 0 && !movesByDisplacement(spec);
  result.set("loads", worst([status([], needsLoad ? ["Add a load."] : []), ...loads]));

  result.set("mesh", status(errorsOf("mesh"), spec.mesh.size === null ? ["Enter a global mesh size."] : []));
  return result;
}

/** What a load still needs before a run, as the tree item's notes. */
/** How a load is named in "Pick the faces the … acts on." */
const loadNoun: Record<LoadType, string> = {
  pressure: "pressure",
  force: "force",
  remote: "remote load",
  hydrostatic: "hydrostatic pressure",
  gravity: "gravity",
  centrifugal: "centrifugal load",
};

function loadMissing(load: Load): string[] {
  const missing: string[] = [];
  if (loadHasFaces(load) && load.faces.length === 0) {
    missing.push(`Pick the faces the ${loadNoun[load.type]} acts on.`);
  }
  if (load.type === "pressure") {
    if (load.magnitude === null) missing.push("Enter the pressure.");
  } else if (load.type === "force" || load.type === "gravity") {
    for (const axis of displacementAxes) {
      if (load[axis] === null) missing.push(`Enter the ${axis} component (0 for none).`);
    }
  } else if (load.type === "remote") {
    if (displacementAxes.some((axis) => load.point[axis] === null)) missing.push("Enter the reference point.");
    if (displacementAxes.some((axis) => load.force[axis] === null)) missing.push("Enter the force (0 for none).");
    if (displacementAxes.some((axis) => load.moment[axis] === null)) missing.push("Enter the moment (0 for none).");
  } else if (load.type === "hydrostatic") {
    if (load.fluidDensity === null) missing.push("Enter the fluid density.");
    if (displacementAxes.some((axis) => load.gravity[axis] === null)) missing.push("Enter the gravity (0 for none).");
    if (displacementAxes.some((axis) => load.freeSurface[axis] === null)) missing.push("Enter a point on the free surface.");
  } else {
    if (load.angularVelocity === null) missing.push("Enter the angular velocity.");
    if (displacementAxes.some((axis) => load.axisPoint[axis] === null)) missing.push("Enter a point on the axis.");
    if (displacementAxes.some((axis) => load.axisDirection[axis] === null)) missing.push("Enter the axis direction.");
  }
  return missing;
}

/** True when two quantities are the same value in the same unit, as the user entered them. */
export function sameQuantity(a: Quantity | null, b: Quantity | null): boolean {
  return a !== null && b !== null && a.value === b.value && a.unit === b.unit;
}

/** True when the mesh was made with the spec's current mesh settings. */
export function meshIsCurrent(spec: SimulationSpec, mesh: MeshView | null): boolean {
  return mesh !== null && sameQuantity(mesh.size, spec.mesh.size);
}

/**
 * The Mesh item's mark once the simulation's mesh is known: its settings' mark from
 * setupStatus, then whether a mesh exists for those settings.
 */
export function meshStatus(settings: ItemStatus, spec: SimulationSpec, mesh: MeshView | null): ItemStatus {
  if (settings.mark !== "complete") return settings;
  if (mesh === null) return { mark: "incomplete", notes: ["Generate the mesh."] };
  if (!meshIsCurrent(spec, mesh)) {
    return { mark: "incomplete", notes: ["The mesh size changed after the mesh was made. Generate the mesh again."] };
  }
  if (mesh.status === "meshing") return { mark: "incomplete", notes: ["The mesh is being made."] };
  if (mesh.status === "failed") return { mark: "error", notes: [mesh.problem ?? "Meshing failed."] };
  return settings;
}

/** The smallest n for which `${prefix}-${n}` is not an id in the spec. */
function nextNumber(spec: SimulationSpec, prefix: string): number {
  const ids = new Set([...spec.materials, ...spec.supports, ...spec.loads].map((item) => item.id));
  let n = 1;
  while (ids.has(`${prefix}-${n}`)) n += 1;
  return n;
}

/** Adds a material. If it is the only one, every body without a material gets it. */
export function addMaterial(spec: SimulationSpec): { spec: SimulationSpec; id: string } {
  const n = nextNumber(spec, "material");
  const material: IsotropicMaterial = {
    id: `material-${n}`,
    name: `Material ${n}`,
    model: "isotropic_elastic",
    youngsModulus: null,
    poissonsRatio: null,
    density: null,
  };
  const first = spec.materials.length === 0;
  return {
    id: material.id,
    spec: {
      ...spec,
      materials: [...spec.materials, material],
      bodies: spec.bodies.map((b) => (first && b.material === null ? { ...b, material: material.id } : b)),
    },
  };
}

/**
 * Adds a support of the given type. A prescribed displacement starts with every component
 * free, so the user gives a value only to the ones it holds.
 */
export function addSupport(
  spec: SimulationSpec,
  type: SupportType,
  faces: readonly number[],
): { spec: SimulationSpec; id: string } {
  const n = nextNumber(spec, type);
  const base = { id: `${type}-${n}`, name: `${supportKinds[type]} ${n}`, faces: [...faces] };
  const support: Support =
    type === "displacement"
      ? { ...base, type, x: "free", y: "free", z: "free" }
      : type === "frictionless"
        ? { ...base, type }
        : { ...base, type: "fixed" };
  return { id: support.id, spec: { ...spec, supports: [...spec.supports, support] } };
}

export function addFixedSupport(spec: SimulationSpec, faces: readonly number[]): { spec: SimulationSpec; id: string } {
  return addSupport(spec, "fixed", faces);
}

/**
 * Adds a load of the given type, with every value still to enter. A pressure, force, remote load
 * or hydrostatic pressure takes the given faces; gravity and a centrifugal load act on every body
 * and have none.
 */
export function addLoad(
  spec: SimulationSpec,
  type: LoadType,
  faces: readonly number[],
): { spec: SimulationSpec; id: string } {
  const n = nextNumber(spec, type);
  const base = { id: `${type}-${n}`, name: `${loadKinds[type]} ${n}` };
  const empty = { x: null, y: null, z: null };
  const load: Load =
    type === "pressure"
      ? { ...base, type, faces: [...faces], magnitude: null }
      : type === "force"
        ? { ...base, type, faces: [...faces], ...empty }
        : type === "remote"
          ? { ...base, type, faces: [...faces], point: { ...empty }, force: { ...empty }, moment: { ...empty } }
          : type === "hydrostatic"
            ? {
                ...base,
                type,
                faces: [...faces],
                fluidDensity: null,
                gravity: { ...empty },
                freeSurface: { ...empty },
              }
            : type === "gravity"
          ? { ...base, type, ...empty }
          : { ...base, type, angularVelocity: null, axisPoint: { ...empty }, axisDirection: { ...empty } };
  return { id: load.id, spec: { ...spec, loads: [...spec.loads, load] } };
}

export function addPressure(spec: SimulationSpec, faces: readonly number[]): { spec: SimulationSpec; id: string } {
  return addLoad(spec, "pressure", faces);
}

export function updateMaterial(spec: SimulationSpec, material: IsotropicMaterial): SimulationSpec {
  return { ...spec, materials: spec.materials.map((m) => (m.id === material.id ? material : m)) };
}

export function updateSupport(spec: SimulationSpec, support: Support): SimulationSpec {
  return { ...spec, supports: spec.supports.map((s) => (s.id === support.id ? support : s)) };
}

export function updateLoad(spec: SimulationSpec, load: Load): SimulationSpec {
  return { ...spec, loads: spec.loads.map((l) => (l.id === load.id ? load : l)) };
}

/** Assigns a material to a body, or takes it off (null). */
export function assignMaterial(spec: SimulationSpec, body: number, material: string | null): SimulationSpec {
  return { ...spec, bodies: spec.bodies.map((b) => (b.tag === body ? { ...b, material } : b)) };
}

/** Removes a material, support or load; bodies that used a removed material are left without one. */
export function removeItem(spec: SimulationSpec, id: string): SimulationSpec {
  return {
    ...spec,
    materials: spec.materials.filter((m) => m.id !== id),
    supports: spec.supports.filter((s) => s.id !== id),
    loads: spec.loads.filter((l) => l.id !== id),
    bodies: spec.bodies.map((b) => (b.material === id ? { ...b, material: null } : b)),
  };
}

/** The faces of a support or load, or null when the id names neither or a load without faces. */
export function facesOf(spec: SimulationSpec, id: string): number[] | null {
  return [...spec.supports, ...spec.loads.filter(loadHasFaces)].find((item) => item.id === id)?.faces ?? null;
}

/** The Run item's mark from the simulation's latest run, or null before the first run. */
export function runStatus(run: RunView | null): ItemStatus {
  if (run === null) return { mark: "incomplete", notes: ["Run the simulation to get results."] };
  if (run.status === "solving") return { mark: "incomplete", notes: ["The simulation is being solved."] };
  if (run.status === "failed") return { mark: "error", notes: [run.problem ?? "The run failed."] };
  return { mark: "complete", notes: [] };
}

/** JSON text with object keys sorted, so two specs compare by content, not key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Whether the setup is still the one a run froze (M1.10). */
export function sameSpec(a: SimulationSpec, b: SimulationSpec): boolean {
  return canonical(a) === canonical(b);
}
