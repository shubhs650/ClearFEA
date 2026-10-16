// SPDX-License-Identifier: AGPL-3.0-or-later
// Pure helpers for the setup tree (M1.5): adding, changing and removing SimulationSpec items,
// and the complete / incomplete / error mark of each tree item. The marks say what an item
// still needs in plain language; the full pre-run list beside the Run button is preRunProblems
// in packages/spec (M1.12).

import {
  type BondStatus,
  bodyLabels,
  bondKey,
  displacementAxes,
  hasBodyLoad,
  hasTemperatureChange,
  type IsotropicMaterial,
  type Load,
  type LocalMeshScope,
  type LocalMeshSize,
  loadHasFaces,
  loadKinds,
  localScopes,
  type MeshView,
  movesByDisplacement,
  type Quantity,
  type RunView,
  type SimulationSpec,
  type Support,
  sameMeshSettings,
  simulationSpecProblems,
  specBonds,
  supportKinds,
  type TopologyTags,
} from "@clearfea/spec";
import { toSi } from "../units/convert";

/** The types of support the setup offers (M1.5 fixed; M2.2 prescribed displacement, frictionless; M2.6 elastic). */
export type SupportType = Support["type"];

/**
 * The types of load the setup offers (M1.5 pressure; M2.3 force, gravity, centrifugal; M2.4 remote;
 * M2.5 hydrostatic; M2.7 temperature change).
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

/**
 * The tree item of a body (M4.1). Bodies are not spec items with ids; a colon cannot appear in a
 * spec id, so these never clash with one.
 */
export function bodyItem(tag: number): string {
  return `body:${tag}`;
}

/** The body tag of a tree item from bodyItem, or null. */
export function bodyOf(item: string): number | null {
  const match = /^body:(\d+)$/.exec(item);
  return match ? Number(match[1]) : null;
}

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
  const temperatureChange = hasTemperatureChange(spec);
  const materials = spec.materials.map((m) => {
    const missing: string[] = [];
    if (m.youngsModulus === null) missing.push("Enter Young's modulus.");
    if (m.poissonsRatio === null) missing.push("Enter Poisson's ratio.");
    if (bodyLoad && (m.density ?? null) === null) missing.push("Enter the density; gravity and centrifugal loads need it.");
    if (temperatureChange && (m.thermalExpansion ?? null) === null) {
      missing.push("Enter the thermal expansion; the temperature change needs it.");
    }
    const s = status(errorsOf(m.id), missing);
    result.set(m.id, s);
    return s;
  });
  // Bodies (M4.1): each body's row is incomplete until it has a material; problems with the body
  // list (an unknown material, a body listed twice) mark the group.
  const labels = topology ? bodyLabels(topology) : new Map<number, string>();
  for (const b of spec.bodies) {
    const missing =
      b.material !== null
        ? []
        : spec.materials.length === 0
          ? ["Add a material under Materials, then pick it here."]
          : ["Pick its material."];
    result.set(bodyItem(b.tag), status([], missing));
  }
  const unassigned = spec.bodies.filter((b) => b.material === null).map((b) => labels.get(b.tag) ?? `Body ${b.tag}`);
  const bodiesMissing =
    unassigned.length === 0
      ? []
      : spec.materials.length === 0
        ? ["Add a material under Materials, then pick each body's material here."]
        : [`Pick a material for ${unassigned.join(", ")}.`];
  result.set("bodies", status(errorsOf("bodies"), bodiesMissing));
  // Bonds (M4.2): incomplete while a detected bond awaits review. Detected bonds are tied all the
  // same, so this is a reminder, not something a run waits for.
  const unreviewed = specBonds(spec, topology).filter((b) => b.status === "detected").length;
  result.set(
    "bonds",
    status(
      errorsOf("bonds"),
      unreviewed === 0
        ? []
        : [`Review ${unreviewed === 1 ? "the detected bond" : `${unreviewed} detected bonds`}: accept or remove each. Bonds not removed are tied.`],
    ),
  );
  result.set("materials", worst([status([], spec.materials.length === 0 ? ["Add a material."] : []), ...materials]));

  const supports = spec.supports.map((s) => {
    const missing: string[] = [];
    if (s.faces.length === 0) {
      missing.push(
        {
          fixed: "Pick the faces to fix.",
          displacement: "Pick the faces to move.",
          frictionless: "Pick the flat faces it holds.",
          elastic: "Pick the faces it supports.",
        }[s.type],
      );
    }
    if (s.type === "elastic" && s.stiffness === null) missing.push("Enter the foundation stiffness.");
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

  const settings = status(errorsOf("mesh"), spec.mesh.size === null ? ["Enter a global mesh size."] : []);
  const global = spec.mesh.size;
  const locals = (spec.mesh.local ?? []).map((item) => {
    const missing: string[] = [];
    if (item.tags.length === 0) missing.push(`Pick the ${localScopes[item.scope].many} to refine.`);
    if (item.size === null) missing.push("Enter the local size.");
    const errors = errorsOf(item.id);
    // Local sizes make the mesh finer (ADR-045); the worker refuses a larger one too.
    if (errors.length === 0 && item.size !== null && global !== null && larger(item.size, global)) {
      errors.push("The local size is larger than the global size. Enter one no larger, or make the global size larger.");
    }
    const s = status(errors, missing);
    result.set(item.id, s);
    return s;
  });
  result.set("mesh", worst([settings, ...locals]));
  return result;
}

/** True when length a is larger than length b; false when either unit is unknown. */
function larger(a: Quantity, b: Quantity): boolean {
  try {
    return toSi(a.value, a.unit, "length") > toSi(b.value, b.unit, "length") * (1 + 1e-9);
  } catch {
    return false;
  }
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
  temperature: "temperature change",
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
  } else if (load.type === "temperature") {
    if (load.change === null) missing.push("Enter the temperature change (negative for cooling).");
  } else {
    if (load.angularVelocity === null) missing.push("Enter the angular velocity.");
    if (displacementAxes.some((axis) => load.axisPoint[axis] === null)) missing.push("Enter a point on the axis.");
    if (displacementAxes.some((axis) => load.axisDirection[axis] === null)) missing.push("Enter the axis direction.");
  }
  return missing;
}

/** True when the mesh was made with the spec's current mesh settings (size, order, local sizes). */
export function meshIsCurrent(spec: SimulationSpec, mesh: MeshView | null): boolean {
  return mesh !== null && sameMeshSettings(spec, mesh);
}

/**
 * The Mesh item's mark once the simulation's mesh is known: its settings' mark from
 * setupStatus, then whether a mesh exists for those settings.
 */
export function meshStatus(settings: ItemStatus, spec: SimulationSpec, mesh: MeshView | null): ItemStatus {
  if (settings.mark !== "complete") return settings;
  if (mesh === null) return { mark: "incomplete", notes: ["Generate the mesh."] };
  if (!meshIsCurrent(spec, mesh)) {
    return { mark: "incomplete", notes: ["The mesh settings changed after the mesh was made. Generate the mesh again."] };
  }
  if (mesh.status === "meshing") return { mark: "incomplete", notes: ["The mesh is being made."] };
  if (mesh.status === "failed") return { mark: "error", notes: [mesh.problem ?? "Meshing failed."] };
  return settings;
}

/** The smallest n for which `${prefix}-${n}` is not an id in the spec. */
function nextNumber(spec: SimulationSpec, prefix: string): number {
  const ids = new Set([...spec.materials, ...spec.supports, ...spec.loads, ...(spec.mesh.local ?? [])].map((item) => item.id));
  let n = 1;
  while (ids.has(`${prefix}-${n}`)) n += 1;
  return n;
}

/**
 * Adds a material: empty, or a copy of a library or saved material (M2.9) under a new id, so
 * the simulation keeps its own values. If it is the only one, every body without a material gets it.
 */
export function addMaterial(spec: SimulationSpec, from?: IsotropicMaterial): { spec: SimulationSpec; id: string } {
  const n = nextNumber(spec, "material");
  const material: IsotropicMaterial = from
    ? { ...from, id: `material-${n}` }
    : {
        id: `material-${n}`,
        name: `Material ${n}`,
        model: "isotropic_elastic",
        youngsModulus: null,
        poissonsRatio: null,
        density: null,
        thermalExpansion: null,
        yieldStrength: null,
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
        : type === "elastic"
          ? { ...base, type, stiffness: null }
          : { ...base, type: "fixed" };
  return { id: support.id, spec: { ...spec, supports: [...spec.supports, support] } };
}

export function addFixedSupport(spec: SimulationSpec, faces: readonly number[]): { spec: SimulationSpec; id: string } {
  return addSupport(spec, "fixed", faces);
}

/**
 * Adds a load of the given type, with every value still to enter. A pressure, force, remote load
 * or hydrostatic pressure takes the given faces; gravity, a centrifugal load and a temperature
 * change act on every body and have none.
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
              : type === "temperature"
                ? { ...base, type, change: null }
                : { ...base, type, angularVelocity: null, axisPoint: { ...empty }, axisDirection: { ...empty } };
  return { id: load.id, spec: { ...spec, loads: [...spec.loads, load] } };
}

export function addPressure(spec: SimulationSpec, faces: readonly number[]): { spec: SimulationSpec; id: string } {
  return addLoad(spec, "pressure", faces);
}

/** Adds a local mesh size on faces, edges or bodies, with the given tags and no size yet (M2.8). */
export function addLocalSize(
  spec: SimulationSpec,
  scope: LocalMeshScope,
  tags: readonly number[],
): { spec: SimulationSpec; id: string } {
  const n = nextNumber(spec, "local");
  const item: LocalMeshSize = { id: `local-${n}`, name: `Local size ${n}`, scope, tags: [...tags], size: null };
  return { id: item.id, spec: { ...spec, mesh: { ...spec.mesh, local: [...(spec.mesh.local ?? []), item] } } };
}

export function updateLocalSize(spec: SimulationSpec, item: LocalMeshSize): SimulationSpec {
  return { ...spec, mesh: { ...spec.mesh, local: (spec.mesh.local ?? []).map((l) => (l.id === item.id ? item : l)) } };
}

/**
 * Changes a material's name or values. A changed value drops the material's source (M2.9), since
 * the values no longer match it.
 */
export function editMaterial(spec: SimulationSpec, material: IsotropicMaterial, changes: Partial<IsotropicMaterial>): SimulationSpec {
  const next: IsotropicMaterial = { ...material, ...changes };
  const values = ["youngsModulus", "poissonsRatio", "density", "thermalExpansion", "yieldStrength"] as const;
  if (values.some((key) => key in changes && changes[key] !== material[key])) delete next.source;
  return updateMaterial(spec, next);
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

/**
 * Sets the review of bonds (M4.2): every bond whose faces are listed in `keys` (bondKey) gets
 * `status`. A spec saved before M4.2 gets its own bond list first.
 */
export function setBondStatus(
  spec: SimulationSpec,
  topology: TopologyTags | undefined,
  keys: readonly string[],
  status: BondStatus,
): SimulationSpec {
  const which = new Set(keys);
  return {
    ...spec,
    bonds: specBonds(spec, topology).map((b) => (which.has(bondKey(b.faces)) ? { ...b, status } : b)),
  };
}

/**
 * Removes a material, support, load or local mesh size; bodies that used a removed material are
 * left without one.
 */
export function removeItem(spec: SimulationSpec, id: string): SimulationSpec {
  const local = spec.mesh.local;
  return {
    ...spec,
    mesh: local === undefined ? spec.mesh : { ...spec.mesh, local: local.filter((l) => l.id !== id) },
    materials: spec.materials.filter((m) => m.id !== id),
    supports: spec.supports.filter((s) => s.id !== id),
    loads: spec.loads.filter((l) => l.id !== id),
    bodies: spec.bodies.map((b) => (b.material === id ? { ...b, material: null } : b)),
  };
}

/**
 * The faces of a support, load or local mesh size on faces, or null when the id names none of
 * them or a load without faces.
 */
export function facesOf(spec: SimulationSpec, id: string): number[] | null {
  const local = (spec.mesh.local ?? []).find((l) => l.id === id && l.scope === "faces");
  if (local) return local.tags;
  return [...spec.supports, ...spec.loads.filter(loadHasFaces)].find((item) => item.id === id)?.faces ?? null;
}

/** The local mesh size with this id, or undefined. */
export function localSizeOf(spec: SimulationSpec, id: string): LocalMeshSize | undefined {
  return (spec.mesh.local ?? []).find((l) => l.id === id);
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
