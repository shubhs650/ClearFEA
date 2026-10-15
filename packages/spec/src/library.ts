// SPDX-License-Identifier: AGPL-3.0-or-later
// The generic material library (../library/materials.json, M2.9, ADR-046), checked when first
// imported: against its schema, and each material for complete values of the right units and a
// source. Values stay in the units the source prints them in; only the units table converts them.

import library from "../library/materials.json";
import { type MaterialLibrary, validateMaterialLibrary } from "./generated/simulation";
import { materialProblems } from "./simulation";

/** Checks a material library beyond its schema; returns it or throws naming every problem. */
export function checkMaterialLibrary(raw: unknown, source = "packages/spec/library/materials.json"): MaterialLibrary {
  const checked = validateMaterialLibrary(raw);
  if (!checked.ok) throw new Error(`${source} does not match its schema: ${checked.errors.join("; ")}`);
  const problems: string[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const material of checked.value.materials) {
    if (ids.has(material.id)) problems.push(`the id ${material.id} is used twice`);
    if (names.has(material.name)) problems.push(`the name "${material.name}" is used twice`);
    ids.add(material.id);
    names.add(material.name);
    if (!material.id.startsWith("lib-")) problems.push(`the id ${material.id} must start with "lib-"`);
    if (material.youngsModulus === null || material.poissonsRatio === null || !material.density) {
      problems.push(`"${material.name}" needs Young's modulus, Poisson's ratio and density`);
    }
    if (!material.source) problems.push(`"${material.name}" needs a source`);
    problems.push(...materialProblems(material));
  }
  if (problems.length > 0) throw new Error(`${source}: ${problems.join("; ")}.`);
  return checked.value;
}

export const materialLibrary: MaterialLibrary = checkMaterialLibrary(library);
