// SPDX-License-Identifier: AGPL-3.0-or-later
// The units table (../units.json), checked against its schema when first imported.
// Conversion code lives with its users: apps/web/src/units/ and worker/clearfea_worker/units.py.

import table from "../units.json";
import { type UnitsTable, validateUnitsTable } from "./generated/units";

function load(): UnitsTable {
  const checked = validateUnitsTable(table);
  if (!checked.ok) {
    throw new Error(`packages/spec/units.json does not match its schema: ${checked.errors.join("; ")}`);
  }
  for (const [kind, entry] of Object.entries(checked.value.kinds)) {
    const si = entry.units[entry.si];
    if (si === undefined || si.factor !== 1 || (si.offset ?? 0) !== 0) {
      throw new Error(
        `packages/spec/units.json: the ${kind} SI unit ${entry.si} must be listed with factor 1 and no offset.`,
      );
    }
  }
  return checked.value;
}

export const unitsTable: UnitsTable = load();
