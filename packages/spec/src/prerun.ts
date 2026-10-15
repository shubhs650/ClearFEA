// SPDX-License-Identifier: AGPL-3.0-or-later
// Pre-run validation (M1.12, ADR-034): everything a saved setup still needs before a run may
// start, in plain language. A pure function over the spec and the geometry's topology, so the
// API refuses a run with exactly the list the web app shows beside the Run button, before any
// machine is used (DECISIONS.md, pricing: pre-run checks). The mesh's own state (made, current)
// is not part of the spec and is checked where the mesh is known.

import type { SimulationSpec } from "./generated/simulation";
import { type SpecProblem, simulationSpecProblems, type TopologyTags } from "./simulation";

/**
 * What stops the setup from being run, in the order of the setup tree, each with the item it
 * belongs to (as in SpecProblem); an empty list when the setup can be run. Problems that make
 * the spec wrong (checkSimulationSpec) come first, then what is still missing.
 */
export function preRunProblems(spec: SimulationSpec, topology?: TopologyTags): SpecProblem[] {
  const problems: SpecProblem[] = simulationSpecProblems(spec, topology);
  const add = (item: string, message: string) => problems.push({ item, message });

  if (spec.materials.length === 0) {
    add("materials", "There is no material. Add a material under Materials.");
  } else {
    const unassigned = spec.bodies.filter((b) => b.material === null).map((b) => b.tag);
    if (unassigned.length > 0) {
      const which = unassigned.length === 1 ? `Body ${unassigned[0]} has` : `Bodies ${unassigned.join(", ")} have`;
      add("bodies", `${which} no material. Assign one under Materials.`);
    }
  }
  for (const material of spec.materials) {
    if (material.youngsModulus === null) {
      add(material.id, `Material "${material.name}" has no Young's modulus. Enter it.`);
    }
    if (material.poissonsRatio === null) {
      add(material.id, `Material "${material.name}" has no Poisson's ratio. Enter it.`);
    }
  }

  if (spec.supports.length === 0) {
    add("supports", "There is no support, so the part is free to move. Add a fixed support.");
  }
  for (const support of spec.supports) {
    if (support.faces.length === 0) {
      add(support.id, `Support "${support.name}" has no faces. Select the faces to fix and add them to it.`);
    }
  }

  if (spec.loads.length === 0) {
    add("loads", "There is no load, so every result would be zero. Add a pressure under Loads.");
  }
  for (const load of spec.loads) {
    if (load.faces.length === 0) {
      add(load.id, `Load "${load.name}" has no faces. Select the faces it acts on and add them to it.`);
    }
    if (load.magnitude === null) add(load.id, `Load "${load.name}" has no pressure value. Enter it.`);
  }

  if (spec.mesh.size === null) add("mesh", "There is no global mesh size. Enter one under Mesh.");
  return problems;
}
