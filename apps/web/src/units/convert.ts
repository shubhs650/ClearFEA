// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit conversion for display, from the single table in packages/spec/units.json
// (docs/ARCHITECTURE.md section 5). Physics-critical. Values sent to the solver are converted
// by the worker, never here. A value in unit u converts to SI as value * factor + offset.

import { type UnitDefinition, type UnitsTable, unitsTable } from "@clearfea/spec";

export class UnitError extends Error {
  override name = "UnitError";
}

function unitOf(kind: string, unit: string, table: UnitsTable): UnitDefinition {
  const entry = table.kinds[kind];
  if (entry === undefined) {
    throw new UnitError(`'${kind}' is not a known quantity kind. Known kinds: ${Object.keys(table.kinds).join(", ")}.`);
  }
  const definition = entry.units[unit];
  if (definition === undefined) {
    throw new UnitError(`'${unit}' is not a ${kind} unit. Use one of: ${Object.keys(entry.units).join(", ")}.`);
  }
  return definition;
}

/** Converts a value entered in `unit` to the SI unit of `kind`. */
export function toSi(value: number, unit: string, kind: string, table: UnitsTable = unitsTable): number {
  const definition = unitOf(kind, unit, table);
  return value * definition.factor + (definition.offset ?? 0);
}

/** Converts a value in the SI unit of `kind` to `unit`. */
export function fromSi(value: number, unit: string, kind: string, table: UnitsTable = unitsTable): number {
  const definition = unitOf(kind, unit, table);
  return (value - (definition.offset ?? 0)) / definition.factor;
}
