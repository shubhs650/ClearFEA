// SPDX-License-Identifier: AGPL-3.0-or-later
// Pre-run validation (M1.12, ADR-034): everything a saved setup still needs before a run may
// start, in plain language. A pure function over the spec and the geometry's topology, so the
// API refuses a run with exactly the list the web app shows beside the Run button, before any
// machine is used (DECISIONS.md, pricing: pre-run checks). The mesh's own state (made, current)
// is not part of the spec and is checked where the mesh is known. Whether the supports hold every
// rigid-body motion needs the mesh's face normals and is checked by the deck generator (ADR-039);
// a body of an assembly that no support or bond reaches at all is found here (M4.4).

import type { Load, SimulationSpec, Support } from "./generated/simulation";
import {
  analysisKinds,
  analysisLoads,
  bodyLabels,
  bondKey,
  displacementAxes,
  faceHeatConflicts,
  hasBodyLoad,
  hasTemperatureChange,
  isThermal,
  loadHasFaces,
  loadKinds,
  localScopes,
  setsTemperature,
  type SpecProblem,
  simulationSpecProblems,
  specBonds,
  supportKinds,
  type TopologyTags,
  unheldBodies,
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

/** A body as messages name it after "Body": its part name in quotes, or its tag (M4.1). */
function bodyName(tag: number, labels: Map<number, string>): string {
  const label = labels.get(tag);
  return label === undefined || label === `Body ${tag}` ? `${tag}` : `"${label}"`;
}

/**
 * One message for each group of bodies no support holds (unheldBodies, M4.4): a body no bond
 * joins to a held body, or bodies bonded only to each other. Where a removed bond touches the
 * group, restoring it is offered as the other way to hold it.
 */
export function unheldBodyMessages(spec: SimulationSpec, topology?: TopologyTags): string[] {
  const groups = unheldBodies(spec, topology);
  if (topology === undefined || groups.length === 0) return [];
  const labels = bodyLabels(topology);
  const candidates = new Map((topology.bonds ?? []).map((b) => [bondKey(b.faces), b.bodies]));
  const removed = new Set(
    specBonds(spec, topology)
      .filter((b) => b.status === "removed")
      .flatMap((b) => candidates.get(bondKey(b.faces)) ?? []),
  );
  return groups.map((group) => {
    const names = group.map((tag) => bodyName(tag, labels));
    const one = group.length === 1;
    const what = one
      ? `Body ${names[0]} is not bonded to a held body and no support holds it, so it is free to move.`
      : `Bodies ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are bonded only to each other and no support holds them, so they are free to move.`;
    const restore = group.some((tag) => removed.has(tag))
      ? `, or restore a removed bond under Bonds that joins ${one ? "it" : "them"} to a held body`
      : "";
    return `${what} Add a support on ${one ? "one of its faces" : "a face of one of them"}${restore}.`;
  });
}

/**
 * Why a support or load does not belong to the setup's analysis type (M5.1, ADR-064), or null when
 * it does: supports and structural loads in a steady-state thermal analysis, a fixed temperature
 * in a linear static one.
 */
export function wrongAnalysisMessage(spec: SimulationSpec, item: Support | Load): string | null {
  const isSupport = (Object.keys(supportKinds) as string[]).includes(item.type);
  if (isSupport ? spec.analysis === "linear_static" : analysisLoads[spec.analysis].includes(item.type as Load["type"])) {
    return null;
  }
  const kind = isSupport ? supportKinds[item.type as Support["type"]] : loadKinds[item.type as Load["type"]];
  const other = spec.analysis === "steady_thermal" ? "linear_static" : "steady_thermal";
  return `${kind} "${item.name}" has no effect in a ${analysisKinds[spec.analysis].toLowerCase()} analysis. Delete it, or set the analysis type to ${analysisKinds[other].toLowerCase()}.`;
}

/**
 * What stops the bodies of a steady-state thermal analysis from having a temperature (M5.1,
 * ADR-064): bonds do not carry heat yet, so bodies bonded to each other cannot be run, and every
 * body needs a fixed temperature, convection or radiation on one of its faces (M5.2, ADR-065).
 * Empty for a single body or without the topology's face bodies.
 */
export function thermalBodyMessages(spec: SimulationSpec, topology?: TopologyTags): string[] {
  if (topology === undefined || topology.bodies.length < 2) return [];
  const messages: string[] = [];
  if (specBonds(spec, topology).some((b) => b.status !== "removed")) {
    messages.push(
      "Bonds do not carry heat in a steady-state thermal analysis yet, so bonded bodies cannot be run. Remove the bonds under Bonds to run each body on its own.",
    );
  }
  const bodiesOf = new Map<number, readonly number[]>();
  for (const face of topology.faces) if (face.bodies !== undefined) bodiesOf.set(face.tag, face.bodies);
  if (bodiesOf.size === 0) return messages;
  const fixed = new Set(
    spec.loads
      .filter(setsTemperature)
      .flatMap((l) => l.faces)
      .flatMap((f) => bodiesOf.get(f) ?? []),
  );
  const labels = bodyLabels(topology);
  const unset = topology.bodies.map((b) => b.tag).filter((tag) => !fixed.has(tag));
  if (unset.length > 0 && fixed.size > 0) {
    const names = unset.map((tag) => bodyName(tag, labels));
    messages.push(
      unset.length === 1
        ? `Body ${names[0]} has no fixed temperature, convection or radiation, so its temperature is not set. Add one on one of its faces.`
        : `Bodies ${names.join(", ")} have no fixed temperature, convection or radiation, so their temperatures are not set. Add one on a face of each.`,
    );
  }
  return messages;
}

/** The missing values and items of a steady-state thermal setup, after the materials and bodies (M5.1, M5.2). */
function thermalProblems(spec: SimulationSpec, topology: TopologyTags | undefined, add: (item: string, message: string) => void) {
  for (const message of thermalBodyMessages(spec, topology)) add("bodies", message);
  for (const material of spec.materials) {
    if ((material.thermalConductivity ?? null) === null) {
      add(material.id, `Material "${material.name}" has no thermal conductivity, which a thermal analysis needs. Enter it.`);
    }
  }
  for (const support of spec.supports) {
    const message = wrongAnalysisMessage(spec, support);
    if (message !== null) add(support.id, message);
  }
  if (!spec.loads.some(setsTemperature)) {
    add(
      "loads",
      "There is no fixed temperature, convection or radiation, so the temperatures are not set anywhere. Add one under Loads.",
    );
  }
  for (const load of spec.loads) {
    const message = wrongAnalysisMessage(spec, load);
    if (message !== null) {
      add(load.id, message);
      continue;
    }
    const missing = (what: string) => add(load.id, `Load "${load.name}" has no ${what}. Enter it.`);
    if (loadHasFaces(load) && load.faces.length === 0) {
      const verb = load.type === "fixed_temperature" ? "holds" : "acts on";
      add(load.id, `Load "${load.name}" has no faces. Select the faces it ${verb} and add them to it.`);
    }
    if (load.type === "fixed_temperature") {
      if (load.temperature === null) missing("temperature");
    } else if (load.type === "heat_flux") {
      if (load.flux === null) missing("heat flux");
    } else if (load.type === "convection") {
      if (load.coefficient === null) missing("convection coefficient");
      if (load.ambientTemperature === null) missing("ambient temperature");
    } else if (load.type === "radiation") {
      if (load.emissivity === null) missing("emissivity");
      if (load.ambientTemperature === null) missing("ambient temperature");
    } else if (load.type === "heat_generation") {
      if (load.bodies.length === 0) add(load.id, `Load "${load.name}" has no bodies. Pick the bodies that produce the heat.`);
      if (load.power === null) missing("heat generation");
    }
  }
  for (const conflict of faceHeatConflicts(spec)) add(conflict.item, conflict.message);
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
    // Named bodies are quoted, others go by their tag: Bodies "Base plate", 3 have ... (M4.1).
    const labels = topology ? bodyLabels(topology) : new Map<number, string>();
    const unassigned = spec.bodies
      .filter((b) => b.material === null)
      .map((b) => {
        const label = labels.get(b.tag);
        return label === undefined || label === `Body ${b.tag}` ? `${b.tag}` : `"${label}"`;
      });
    if (unassigned.length > 0) {
      add(
        "bodies",
        unassigned.length === 1
          ? `Body ${unassigned[0]} has no material. Pick one for it under Bodies.`
          : `Bodies ${unassigned.join(", ")} have no material. Pick one for each under Bodies.`,
      );
    }
  }
  if (isThermal(spec)) {
    thermalProblems(spec, topology, add);
    meshProblems(spec, add);
    return problems;
  }
  for (const message of unheldBodyMessages(spec, topology)) add("bodies", message);
  const bodyLoad = hasBodyLoad(spec);
  const temperatureChange = hasTemperatureChange(spec);
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
    if (temperatureChange && (material.thermalExpansion ?? null) === null) {
      add(material.id, `Material "${material.name}" has no thermal expansion, which a temperature change needs. Enter it.`);
    }
  }

  if (spec.supports.length === 0) {
    add("supports", "There is no support, so the part is free to move. Add a support under Supports.");
  }
  for (const support of spec.supports) {
    if (support.faces.length === 0) {
      const what = { fixed: "to fix", displacement: "to move", frictionless: "it holds", elastic: "it supports" }[support.type];
      add(support.id, `Support "${support.name}" has no faces. Select the faces ${what} and add them to it.`);
    }
    if (support.type === "elastic" && support.stiffness === null) {
      add(support.id, `Support "${support.name}" has no foundation stiffness. Enter it.`);
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
    const wrong = wrongAnalysisMessage(spec, load);
    if (wrong !== null) {
      add(load.id, wrong);
      continue;
    }
    if (loadHasFaces(load) && load.faces.length === 0) {
      const verb = load.type === "fixed_temperature" ? "holds" : "acts on";
      add(load.id, `Load "${load.name}" has no faces. Select the faces it ${verb} and add them to it.`);
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
    } else if (load.type === "hydrostatic") {
      if (load.fluidDensity === null) add(load.id, `Load "${load.name}" has no fluid density. Enter it.`);
      if (displacementAxes.some((axis) => load.gravity[axis] === null)) {
        add(load.id, `Load "${load.name}" has no complete gravity. Enter x, y and z (0 for none).`);
      }
      if (displacementAxes.some((axis) => load.freeSurface[axis] === null)) {
        add(load.id, `Load "${load.name}" has no complete point on the free surface. Enter x, y and z.`);
      }
    } else if (load.type === "temperature") {
      if (load.change === null) add(load.id, `Load "${load.name}" has no temperature change. Enter it (negative for cooling).`);
    } else if (load.type === "centrifugal") {
      if (load.angularVelocity === null) add(load.id, `Load "${load.name}" has no angular velocity. Enter it.`);
      if (displacementAxes.some((axis) => load.axisPoint[axis] === null)) {
        add(load.id, `Load "${load.name}" has no complete point on its axis. Enter x, y and z.`);
      }
      if (displacementAxes.some((axis) => load.axisDirection[axis] === null)) {
        add(load.id, `Load "${load.name}" has no complete axis direction. Enter x, y and z.`);
      }
    }
  }

  meshProblems(spec, add);
  return problems;
}

/** What the mesh settings still need. */
function meshProblems(spec: SimulationSpec, add: (item: string, message: string) => void) {
  if (spec.mesh.size === null) add("mesh", "There is no global mesh size. Enter one under Mesh.");
  for (const item of spec.mesh.local ?? []) {
    const { many } = localScopes[item.scope];
    if (item.tags.length === 0) {
      add(item.id, `Local mesh size "${item.name}" has no ${many}. Select the ${many} to refine and add them to it, or delete it.`);
    }
    if (item.size === null) add(item.id, `Local mesh size "${item.name}" has no size. Enter it.`);
  }
}
