// SPDX-License-Identifier: AGPL-3.0-or-later
// The project's unit system (M2.1, ADR-038), shared with every quantity input and result figure.
// A system names one unit per quantity kind in packages/spec/units.json: the unit a field offers
// first and the unit results are shown in. Stored values keep the unit they were typed in.

import { systemUnit, unitsTable } from "@clearfea/spec";
import { createContext, useContext } from "react";

/** A quantity kind of packages/spec/units.json. */
export type QuantityKind = keyof (typeof import("@clearfea/spec/units.json"))["kinds"];

const UnitSystemContext = createContext<string>(unitsTable.defaultSystem);

export const UnitSystemProvider = UnitSystemContext.Provider;

/** Id of the project's unit system. */
export function useUnitSystem(): string {
  return useContext(UnitSystemContext);
}

/** The unit the project's system uses for a kind. */
export function useSystemUnit(kind: QuantityKind): string {
  return systemUnit(useContext(UnitSystemContext), kind);
}

/** The table's unit systems as id and name, in table order, for a choice list. */
export const UNIT_SYSTEMS: readonly { id: string; name: string }[] = Object.entries(unitsTable.systems).map(
  ([id, system]) => ({ id, name: system.name }),
);
