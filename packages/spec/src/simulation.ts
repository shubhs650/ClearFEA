// SPDX-License-Identifier: AGPL-3.0-or-later
// Checks on a SimulationSpec that its JSON Schema cannot express (ADR-026): units of the right
// kind, positive sizes, unique ids, references between items, and tags that exist in the
// geometry. A spec that passes may still be incomplete; what is missing for a run is
// pre-run validation's job (M1.12).

import type { Quantity, SimulationSpec } from "./generated/simulation";
import { unitsTable } from "./units";

/** The bodies and faces of a geometry, as topology.json lists them. */
export interface TopologyTags {
  bodies: readonly { tag: number }[];
  faces: readonly { tag: number }[];
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
    mesh: { size: null },
  };
}

function unitProblem(
  quantity: Quantity | null,
  kind: "length" | "pressure",
  what: string,
  positive: boolean,
): string | null {
  if (quantity === null) return null;
  const units = unitsTable.kinds[kind]?.units ?? {};
  if (!Object.hasOwn(units, quantity.unit)) {
    return `${what} is given in "${quantity.unit}", which is not a ${kind} unit. Use one of: ${Object.keys(units).join(", ")}.`;
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
    add(material.id, unitProblem(material.youngsModulus, "pressure", `Young's modulus of material "${material.name}"`, true));
  }
  for (const load of spec.loads) {
    add(load.id, unitProblem(load.magnitude, "pressure", `The magnitude of load "${load.name}"`, false));
  }
  add("mesh", unitProblem(spec.mesh.size, "length", "The global mesh size", true));

  if (topology !== undefined) {
    const known = new Set(topology.bodies.map((b) => b.tag));
    const unknownBodies = [...bodyTags].filter((tag) => !known.has(tag));
    const missingBodies = [...known].filter((tag) => !bodyTags.has(tag));
    if (unknownBodies.length > 0) add("bodies", `The geometry has no body ${listTags(unknownBodies)}.`);
    if (missingBodies.length > 0) add("bodies", `Body ${listTags(missingBodies)} of the geometry is not listed in bodies.`);

    const faces = new Set(topology.faces.map((f) => f.tag));
    const faceItems = [
      ...spec.supports.map((s) => ({ id: s.id, faces: s.faces, label: `Support "${s.name}"` })),
      ...spec.loads.map((l) => ({ id: l.id, faces: l.faces, label: `Load "${l.name}"` })),
    ];
    for (const entry of faceItems) {
      const unknown = entry.faces.filter((tag) => !faces.has(tag));
      if (unknown.length > 0) {
        add(entry.id, `${entry.label} uses face ${listTags(unknown)}, which the geometry does not have.`);
      }
    }
  }
  return problems;
}
