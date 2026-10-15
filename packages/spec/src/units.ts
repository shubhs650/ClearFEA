// SPDX-License-Identifier: AGPL-3.0-or-later
// The units table (../units.json), checked against its schema when first imported.
// Conversion code lives with its users: apps/web/src/units/ and worker/clearfea_worker/units.py.

import table from "../units.json";
import { type UnitsTable, validateUnitsTable } from "./generated/units";

/**
 * Checks a units table beyond its schema: each kind's SI unit has factor 1 and no offset, and
 * every unit system names a unit of the right kind for every kind (ADR-018, ADR-038).
 * worker/clearfea_worker/units.py makes the same checks.
 */
export function checkUnitsTable(raw: unknown, source = "packages/spec/units.json"): UnitsTable {
  const checked = validateUnitsTable(raw);
  if (!checked.ok) {
    throw new Error(`${source} does not match its schema: ${checked.errors.join("; ")}`);
  }
  const value = checked.value;
  for (const [kind, entry] of Object.entries(value.kinds)) {
    const si = entry.units[entry.si];
    if (si === undefined || si.factor !== 1 || (si.offset ?? 0) !== 0) {
      throw new Error(`${source}: the ${kind} SI unit ${entry.si} must be listed with factor 1 and no offset.`);
    }
  }
  for (const [id, system] of Object.entries(value.systems)) {
    for (const [kind, entry] of Object.entries(value.kinds)) {
      const unit = system.units[kind];
      if (unit === undefined || entry.units[unit] === undefined) {
        throw new Error(`${source}: the unit system ${id} must name a ${kind} unit listed under ${kind}.`);
      }
    }
    for (const kind of Object.keys(system.units)) {
      if (value.kinds[kind] === undefined) {
        throw new Error(`${source}: the unit system ${id} names '${kind}', which is not a quantity kind.`);
      }
    }
  }
  if (value.systems[value.defaultSystem] === undefined) {
    throw new Error(`${source}: the default unit system ${value.defaultSystem} is not listed under systems.`);
  }
  return value;
}

export const unitsTable: UnitsTable = checkUnitsTable(table);

/** Whether `id` names a unit system of the table. */
export function isUnitSystem(id: string, units: UnitsTable = unitsTable): boolean {
  return Object.hasOwn(units.systems, id);
}

/**
 * The unit a system uses for a kind. An unknown system falls back to the table's default, so a
 * project saved with a system that was later removed still shows numbers.
 */
export function systemUnit(system: string, kind: string, units: UnitsTable = unitsTable): string {
  const chosen = isUnitSystem(system, units) ? system : units.defaultSystem;
  const unit = units.systems[chosen]?.units[kind];
  if (unit === undefined) throw new Error(`'${kind}' is not a known quantity kind.`);
  return unit;
}
