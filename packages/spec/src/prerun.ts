// SPDX-License-Identifier: AGPL-3.0-or-later
// Pre-run validation (M1.12, ADR-034): everything a saved setup still needs before a run may
// start, in plain language. A pure function over the spec and the geometry's topology, so the
// API refuses a run with exactly the list the web app shows beside the Run button, before any
// machine is used (DECISIONS.md, pricing: pre-run checks). The mesh's own state (made, current)
// is not part of the spec and is checked where the mesh is known. Whether the supports hold every
// rigid-body motion needs the mesh's face normals and is checked by the deck generator (ADR-039).

import type { SimulationSpec } from "./generated/simulation";
import {
  displacementAxes,
  hasBodyLoad,
  loadHasFaces,
  type SpecProblem,
  simulationSpecProblems,
  type TopologyTags,
} from "./simulation";

/** True when the setup moves something by itself: a prescribed displacement other than zero. */
export function movesByDisplacement(spec: SimulationSpec): boolean {
  return spec.supports.some(
    (s) =>
      s.type === "displacement" &&
      displacementAxes.some((axis) => {
        const c = s[axis];
        return c !== null && c !== "free" && c.value !== 0;
      }),
  );
}

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
  const bodyLoad = hasBodyLoad(spec);
  for (const material of spec.materials) {
    if (material.youngsModulus === null) {
      add(material.id, `Material "${material.name}" has no Young's modulus. Enter it.`);
    }
    if (material.poissonsRatio === null) {
      add(material.id, `Material "${material.name}" has no Poisson's ratio. Enter it.`);
    }
    if (bodyLoad && (material.density ?? null) === null) {
      add(material.id, `Material "${material.name}" has no density, which gravity and centrifugal loads need. Enter it.`);
    }
  }

  if (spec.supports.length === 0) {
    add("supports", "There is no support, so the part is free to move. Add a support under Supports.");
  }
  for (const support of spec.supports) {
    if (support.faces.length === 0) {
      const what = { fixed: "to fix", displacement: "to move", frictionless: "it holds" }[support.type];
      add(support.id, `Support "${support.name}" has no faces. Select the faces ${what} and add them to it.`);
    }
    if (support.type === "displacement") {
      const missing = displacementAxes.filter((axis) => support[axis] === null);
      for (const axis of missing) {
        add(support.id, `Support "${support.name}" has no value for its ${axis} component. Enter one or set it free.`);
      }
      if (displacementAxes.every((axis) => support[axis] === "free")) {
        add(
          support.id,
          `Support "${support.name}" leaves every component free, so it holds nothing. Give at least one component a value (0 holds the faces in that direction).`,
        );
      }
    }
  }

  // A prescribed displacement other than zero loads the part by itself (ADR-034 item 3,
  // narrowed by ADR-039).
  if (spec.loads.length === 0 && !movesByDisplacement(spec)) {
    add(
      "loads",
      "There is no load, so every result would be zero. Add a load under Loads, or give a prescribed displacement a value other than zero.",
    );
  }
  for (const load of spec.loads) {
    if (loadHasFaces(load) && load.faces.length === 0) {
      add(load.id, `Load "${load.name}" has no faces. Select the faces it acts on and add them to it.`);
    }
    if (load.type === "pressure") {
      if (load.magnitude === null) add(load.id, `Load "${load.name}" has no pressure value. Enter it.`);
    } else if (load.type === "force" || load.type === "gravity") {
      for (const axis of displacementAxes) {
        if (load[axis] === null) add(load.id, `Load "${load.name}" has no value for its ${axis} component. Enter one (0 for none).`);
      }
    } else if (load.type === "remote") {
      if (displacementAxes.some((axis) => load.point[axis] === null)) {
        add(load.id, `Load "${load.name}" has no complete reference point. Enter x, y and z.`);
      }
      if (displacementAxes.some((axis) => load.force[axis] === null)) {
        add(load.id, `Load "${load.name}" has no complete force. Enter x, y and z (0 for none).`);
      }
      if (displacementAxes.some((axis) => load.moment[axis] === null)) {
        add(load.id, `Load "${load.name}" has no complete moment. Enter x, y and z (0 for none).`);
      }
    } else {
      if (load.angularVelocity === null) add(load.id, `Load "${load.name}" has no angular velocity. Enter it.`);
      if (displacementAxes.some((axis) => load.axisPoint[axis] === null)) {
        add(load.id, `Load "${load.name}" has no complete point on its axis. Enter x, y and z.`);
      }
      if (displacementAxes.some((axis) => load.axisDirection[axis] === null)) {
        add(load.id, `Load "${load.name}" has no complete axis direction. Enter x, y and z.`);
      }
    }
  }

  if (spec.mesh.size === null) add("mesh", "There is no global mesh size. Enter one under Mesh.");
  return problems;
}
