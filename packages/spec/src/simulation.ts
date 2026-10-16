// SPDX-License-Identifier: AGPL-3.0-or-later
// Checks on a SimulationSpec that its JSON Schema cannot express (ADR-026): units of the right
// kind, positive sizes, unique ids, references between items, and tags that exist in the
// geometry. A spec that passes may still be incomplete; what is missing for a run is
// pre-run validation's job (preRunProblems in prerun.ts, M1.12).

import type {
  AnalysisType,
  Bond,
  BondStatus,
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
  /** name: the body's part name from the STEP file, when it has one (M4.1, ADR-058). */
  bodies: readonly { tag: number; name?: string }[];
  /** bodies: the body each face belongs to, as topology.json lists it (used by unheldBodies, M4.4). */
  faces: readonly { tag: number; type?: string; bodies?: readonly number[] }[];
  edges?: readonly { tag: number }[];
  /**
   * Candidate bonds between touching faces of different bodies (M4.2, ADR-059), with the contact
   * area (m²) and largest gap (m) where known. Absent for geometries imported before M4.2.
   */
  bonds?: readonly TopologyBondTags[];
}

/** A candidate bond as topology.json lists it (M4.2): two faces, smaller tag first, and their bodies. */
export interface TopologyBondTags {
  faces: readonly [number, number];
  bodies: readonly [number, number];
  area?: number;
  gap?: number;
}

/** The text a bond is told apart by: its two faces, smaller first ("6-11"). */
export function bondKey(faces: readonly number[]): string {
  return [...faces].sort((a, b) => a - b).join("-");
}

/**
 * Every candidate bond of the geometry with the user's review of it (M4.2, ADR-059): the spec's
 * own list, or, in a spec saved before M4.2, every candidate as detected.
 */
export function specBonds(spec: SimulationSpec, topology?: TopologyTags): Bond[] {
  if (spec.bonds !== undefined) return spec.bonds;
  return (topology?.bonds ?? []).map((b) => ({ faces: [b.faces[0], b.faces[1]], status: "detected" }));
}

/** True when a bond with this review is tied in the solver deck: every bond the user has not removed. */
export function bondIsTied(status: BondStatus): boolean {
  return status !== "removed";
}

/**
 * The bodies no support holds (M4.4), as groups of body tags: bodies joined by tied bonds
 * (bondIsTied) are one piece, and a piece is held when a support has a face on one of its bodies.
 * Each group is sorted, groups in order of their smallest tag. Bodies are meshed apart and share
 * no nodes (ADR-058), so a body no bond joins to a held body is free to move whatever holds the
 * others. Empty for a single body, when no support has faces yet (the setup asks for a support
 * then), or when the topology does not say which body each face is on. Whether the supports hold
 * every rigid-body motion of a piece needs the mesh and is checked by the deck generator.
 */
export function unheldBodies(spec: SimulationSpec, topology?: TopologyTags): number[][] {
  if (topology === undefined || topology.bodies.length < 2) return [];
  const bodiesOf = new Map<number, readonly number[]>();
  for (const face of topology.faces) if (face.bodies !== undefined) bodiesOf.set(face.tag, face.bodies);
  const supported = spec.supports.flatMap((s) => s.faces);
  if (bodiesOf.size === 0 || supported.length === 0) return [];

  const parent = new Map<number, number>(topology.bodies.map((b) => [b.tag, b.tag]));
  const root = (tag: number): number => {
    let r = tag;
    while ((parent.get(r) ?? r) !== r) r = parent.get(r) ?? r;
    return r;
  };
  const candidates = new Map((topology.bonds ?? []).map((b) => [bondKey(b.faces), b.bodies]));
  for (const bond of specBonds(spec, topology)) {
    const [first, second] = candidates.get(bondKey(bond.faces)) ?? [];
    if (!bondIsTied(bond.status) || first === undefined || second === undefined) continue;
    const [a, b] = [root(first), root(second)];
    if (a !== b && parent.has(a) && parent.has(b)) parent.set(Math.max(a, b), Math.min(a, b));
  }
  const held = new Set(supported.flatMap((f) => bodiesOf.get(f) ?? []).map(root));
  const groups = new Map<number, number[]>();
  for (const tag of topology.bodies.map((b) => b.tag).sort((a, b) => a - b)) {
    const r = root(tag);
    if (!held.has(r)) groups.set(r, [...(groups.get(r) ?? []), tag]);
  }
  // Groups are made in tag order, so they come out in order of their smallest tag.
  return [...groups.values()];
}

/**
 * What the setup calls each body (M4.1, ADR-058): its part name from the STEP file, or "Body <tag>"
 * when the file gives none. A name several bodies share (a part used twice) gets the tag added,
 * "Bolt (body 3)", so every label is unique.
 */
export function bodyLabels(topology: TopologyTags): Map<number, string> {
  const uses = new Map<string, number>();
  for (const body of topology.bodies) {
    if (body.name !== undefined) uses.set(body.name, (uses.get(body.name) ?? 0) + 1);
  }
  return new Map(
    topology.bodies.map((body) => {
      if (body.name === undefined) return [body.tag, `Body ${body.tag}`];
      return [body.tag, (uses.get(body.name) ?? 0) > 1 ? `${body.name} (body ${body.tag})` : body.name];
    }),
  );
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
  fixed_temperature: "Fixed temperature",
  heat_flux: "Heat flux",
  convection: "Convection",
  radiation: "Radiation",
  heat_generation: "Heat generation",
} as const;

/** The analysis types as the setup names them (M5.1, ADR-064). */
export const analysisKinds = {
  linear_static: "Linear static",
  steady_thermal: "Steady-state thermal",
  thermal_stress: "Thermal stress",
} as const;

const structuralLoads = ["pressure", "force", "remote", "hydrostatic", "gravity", "centrifugal"] as const;
const thermalLoads = ["fixed_temperature", "heat_flux", "convection", "radiation", "heat_generation"] as const;

/**
 * The load types each analysis type takes (M5.1, ADR-064; M5.2, ADR-065). A thermal stress
 * analysis (M5.4, ADR-067) takes both kinds but not a uniform temperature change, since its
 * temperatures come from its thermal step. Supports belong to the analyses with a static step.
 */
export const analysisLoads: Record<AnalysisType, readonly Load["type"][]> = {
  linear_static: [...structuralLoads, "temperature"],
  steady_thermal: thermalLoads,
  thermal_stress: [...structuralLoads, ...thermalLoads],
};

/** True for an analysis that solves temperatures only, with no displacement or stress (M5.1). */
export function isThermal(spec: Pick<SimulationSpec, "analysis">): boolean {
  return spec.analysis === "steady_thermal";
}

/** True for an analysis with a thermal step, which solves temperatures (M5.1, M5.4). */
export function solvesTemperature(spec: Pick<SimulationSpec, "analysis">): boolean {
  return spec.analysis === "steady_thermal" || spec.analysis === "thermal_stress";
}

/** True for an analysis with a static step, which takes supports and solves displacements and stresses (M5.4). */
export function solvesStress(spec: Pick<SimulationSpec, "analysis">): boolean {
  return spec.analysis !== "steady_thermal";
}

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

/** Bumped when the mesher changes what the same settings produce, so older meshes stop being reused. */
export const MESH_SETTINGS_VERSION = 1;

/**
 * The text the mesh-settings hash is taken of (M2.10, ADR-047): everything that decides a mesh,
 * which is the geometry, the scale it is imported at (its unit), the global size, the element
 * order and the local sizes, in the form sameMeshSettings compares them (sizes as entered, local
 * sizes complete and with sorted tags, in setup order). Keys are written in a fixed order so equal
 * settings always give equal text.
 */
export function meshSettingsText(settings: {
  geometryId: string;
  scaling: number;
  size: Quantity;
  order: ElementOrder;
  local: readonly LocalSizeParams[];
}): string {
  const quantity = (q: Quantity) => ({ value: q.value, unit: q.unit });
  return JSON.stringify({
    version: MESH_SETTINGS_VERSION,
    geometryId: settings.geometryId,
    scaling: settings.scaling,
    size: quantity(settings.size),
    order: settings.order,
    local: settings.local.map((l) => ({
      scope: l.scope,
      tags: [...l.tags].sort((a, b) => a - b),
      size: quantity(l.size),
    })),
  });
}

/**
 * True when the load acts on faces the user picks (gravity, centrifugal and temperature act on every
 * body; heat generation on the bodies it lists).
 */
export function loadHasFaces(load: Load): load is Extract<Load, { faces: number[] }> {
  return (
    load.type === "pressure" ||
    load.type === "force" ||
    load.type === "remote" ||
    load.type === "hydrostatic" ||
    load.type === "fixed_temperature" ||
    load.type === "heat_flux" ||
    load.type === "convection" ||
    load.type === "radiation"
  );
}

/**
 * True for a thermal load that ties the temperature to a value (M5.2, ADR-065): a fixed temperature,
 * convection or radiation, which bring their own or an ambient temperature. A body needs one;
 * a heat flux and heat generation only add heat.
 */
export function setsTemperature(
  load: Load,
): load is Extract<Load, { type: "fixed_temperature" | "convection" | "radiation" }> {
  return load.type === "fixed_temperature" || load.type === "convection" || load.type === "radiation";
}

/** True when the setup has a gravity or centrifugal load, which need every material's density. */
export function hasBodyLoad(spec: SimulationSpec): boolean {
  return spec.loads.some((l) => l.type === "gravity" || l.type === "centrifugal");
}

/** True when the setup has a temperature change, which needs every material's thermal expansion. */
export function hasTemperatureChange(spec: SimulationSpec): boolean {
  return spec.loads.some((l) => l.type === "temperature");
}

/** A new, empty spec for a geometry: every body and every candidate bond listed, nothing else set. */
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
    solver: "pastix",
    // Every candidate bond starts tied and unreviewed (M4.2); geometries imported before M4.2 have none.
    ...(topology.bonds === undefined
      ? {}
      : { bonds: topology.bonds.map((b) => ({ faces: [b.faces[0], b.faces[1]], status: "detected" as const })) }),
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
  temperature: "a temperature",
  thermalConductivity: "a thermal conductivity",
  heatFlux: "a heat flux",
  heatTransferCoefficient: "a heat transfer coefficient",
  heatGeneration: "a heat generation",
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
 * What is wrong with a material's values (units of the wrong kind, a modulus, density or yield
 * strength of zero or less), in plain language; empty when nothing is. Missing values are not wrong here.
 */
export function materialProblems(material: IsotropicMaterial): string[] {
  return [
    unitProblem(material.youngsModulus, "pressure", `Young's modulus of material "${material.name}"`, true),
    unitProblem(material.density ?? null, "density", `The density of material "${material.name}"`, true),
    unitProblem(material.thermalExpansion ?? null, "thermalExpansion", `The thermal expansion of material "${material.name}"`, false),
    unitProblem(material.yieldStrength ?? null, "pressure", `The yield strength of material "${material.name}"`, true),
    unitProblem(
      material.thermalConductivity ?? null,
      "thermalConductivity",
      `The thermal conductivity of material "${material.name}"`,
      true,
    ),
  ].filter((problem) => problem !== null);
}

/**
 * A problem with a spec and the item it belongs to: the id of a material, support or load,
 * "bodies" for the body list, "bonds" for the bond list, "mesh" for the mesh settings.
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
    } else if (load.type === "fixed_temperature") {
      add(load.id, unitProblem(load.temperature, "temperature", `The temperature of load "${load.name}"`, false));
    } else if (load.type === "heat_flux") {
      add(load.id, unitProblem(load.flux, "heatFlux", `The heat flux of load "${load.name}"`, false));
    } else if (load.type === "convection") {
      add(load.id, unitProblem(load.coefficient, "heatTransferCoefficient", `The coefficient of load "${load.name}"`, true));
      add(load.id, unitProblem(load.ambientTemperature, "temperature", `The ambient temperature of load "${load.name}"`, false));
    } else if (load.type === "radiation") {
      add(load.id, unitProblem(load.ambientTemperature, "temperature", `The ambient temperature of load "${load.name}"`, false));
    } else if (load.type === "heat_generation") {
      add(load.id, unitProblem(load.power, "heatGeneration", `The heat generation of load "${load.name}"`, false));
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
  add(
    "analysis",
    unitProblem(spec.stressFreeTemperature ?? null, "temperature", "The stress-free temperature", false),
  );
  add("mesh", unitProblem(spec.mesh.size, "length", "The global mesh size", true));
  for (const item of spec.mesh.local ?? []) {
    add(item.id, unitProblem(item.size, "length", `The size of local mesh size "${item.name}"`, true));
    const repeated = item.tags.filter((tag, k) => item.tags.indexOf(tag) !== k);
    if (repeated.length > 0) {
      add(item.id, `Local mesh size "${item.name}" lists ${localScopes[item.scope].one} ${listTags(repeated)} more than once.`);
    }
  }

  const bondKeys = new Set<string>();
  for (const bond of spec.bonds ?? []) {
    const key = bondKey(bond.faces);
    if (bondKeys.has(key)) add("bonds", `The bond between faces ${bond.faces.join(" and ")} is listed more than once.`);
    bondKeys.add(key);
  }

  if (topology !== undefined) {
    // Bonds (M4.2): the spec reviews exactly the geometry's candidates; no bond can be made by hand.
    if (spec.bonds !== undefined) {
      if (topology.bonds === undefined) {
        if (spec.bonds.length > 0) {
          add("bonds", "The setup lists bonds, but this geometry was imported before bonds were detected. Upload the STEP file again.");
        }
      } else {
        const candidates = new Set(topology.bonds.map((b) => bondKey(b.faces)));
        for (const bond of spec.bonds) {
          if (!candidates.has(bondKey(bond.faces))) {
            add("bonds", `The geometry has no bond between faces ${bond.faces.join(" and ")}.`);
          }
        }
        for (const bond of topology.bonds) {
          if (!bondKeys.has(bondKey(bond.faces))) {
            add("bonds", `The bond between faces ${bond.faces.join(" and ")} of the geometry is not listed in bonds.`);
          }
        }
      }
    }

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
    for (const load of spec.loads) {
      if (load.type !== "heat_generation") continue;
      const unknown = load.bodies.filter((tag) => !known.has(tag));
      if (unknown.length > 0) add(load.id, `Load "${load.name}" uses body ${listTags(unknown)}, which the geometry does not have.`);
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

/**
 * Faces where two thermal loads cannot both act (M5.2, ADR-065): a heat flux, convection or
 * radiation on a face a fixed temperature holds (the fixed temperature sets the temperature there,
 * so the load would have no effect), and two convections or two radiations on one face (the solver
 * would keep one without saying which). Heat fluxes on one face add up. Each message belongs to the
 * later of the two loads.
 */
export function faceHeatConflicts(spec: SimulationSpec): SpecProblem[] {
  const held = new Map<number, string>();
  for (const load of spec.loads) {
    if (load.type === "fixed_temperature") for (const face of load.faces) if (!held.has(face)) held.set(face, load.name);
  }
  const seen = new Map<string, string>();
  const out: SpecProblem[] = [];
  for (const load of spec.loads) {
    if (load.type !== "heat_flux" && load.type !== "convection" && load.type !== "radiation") continue;
    const kind = loadKinds[load.type];
    for (const face of load.faces) {
      const fixed = held.get(face);
      if (fixed !== undefined) {
        out.push({
          item: load.id,
          message: `${kind} "${load.name}" acts on face ${face}, which fixed temperature "${fixed}" holds, so it would have no effect. Remove the face from one of them.`,
        });
        continue;
      }
      if (load.type === "heat_flux") continue;
      const key = `${load.type}:${face}`;
      const other = seen.get(key);
      if (other === undefined) {
        seen.set(key, load.name);
      } else {
        out.push({
          item: load.id,
          message: `${kind} "${other}" and "${load.name}" both act on face ${face}. Give each face one ${kind.toLowerCase()}; combine them into one if both are meant.`,
        });
      }
    }
  }
  return out;
}
