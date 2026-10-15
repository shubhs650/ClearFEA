// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated from packages/spec/schemas/units.schema.json by packages/spec/scripts/generate.mjs.
// Do not edit by hand; change the schema and run `make spec`.

import schema from "../../schemas/units.schema.json";
import { validator } from "../validate";

/**
 * Shape of packages/spec/units.json, the single table of quantity kinds, allowed units and unit systems. A value in unit u converts to SI as value * factor + offset.
 */
export interface UnitsTable {
  version: number;
  kinds: {
    [k: string]: QuantityKind;
  };
  /**
   * Named unit systems, keyed by id. A system names one unit for every kind; it is the unit a quantity field offers first and the unit results are shown in. Values are still stored as typed.
   */
  systems: {
    [k: string]: UnitSystem;
  };
  /**
   * Id of the system a project uses until its owner chooses another.
   */
  defaultSystem: string;
}
/**
 * This interface was referenced by `UnitsTable`'s JSON-Schema
 * via the `definition` "QuantityKind".
 */
export interface QuantityKind {
  description?: string;
  /**
   * The SI unit stored and solved in. It must appear in units with factor 1 and offset 0.
   */
  si: string;
  units: {
    [k: string]: UnitDefinition;
  };
}
/**
 * This interface was referenced by `UnitsTable`'s JSON-Schema
 * via the `definition` "UnitDefinition".
 */
export interface UnitDefinition {
  factor: number;
  offset?: number;
  /**
   * Where the factor comes from, so a reviewer can check it.
   */
  definition: string;
}
/**
 * This interface was referenced by `UnitsTable`'s JSON-Schema
 * via the `definition` "UnitSystem".
 */
export interface UnitSystem {
  /**
   * Shown in the unit system choice.
   */
  name: string;
  /**
   * Quantity kind to unit symbol. Every kind of the table must appear, with a unit listed under that kind.
   */
  units: {
    [k: string]: string;
  };
}

export const validateUnitsTable = validator<UnitsTable>(schema);
export const validateQuantityKind = validator<QuantityKind>(schema, "QuantityKind");
export const validateUnitDefinition = validator<UnitDefinition>(schema, "UnitDefinition");
export const validateUnitSystem = validator<UnitSystem>(schema, "UnitSystem");
