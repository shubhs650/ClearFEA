// SPDX-License-Identifier: AGPL-3.0-or-later
// Runtime validation against the JSON Schemas in ../schemas. Uses @cfworker/json-schema
// because it interprets schemas without generating code, which Cloudflare Workers forbid.

import { type OutputUnit, type Schema, Validator } from "@cfworker/json-schema";

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/**
 * Builds a validator for a whole schema, or for one entry of its `$defs`.
 * Called by the generated modules, which pair each schema with its generated type.
 */
export function validator<T>(schema: object, definition?: string): (value: unknown) => Validation<T> {
  const root = schema as Schema;
  const target: Schema =
    definition === undefined ? root : { $defs: root.$defs, $ref: `#/$defs/${definition}` };
  const compiled = new Validator(target, "2020-12", false);
  return (value) => {
    // The validator only knows JSON types and throws on undefined (for example, an empty body).
    if (value === undefined) return { ok: false, errors: ["/ is missing."] };
    const result = compiled.validate(value);
    return result.valid ? { ok: true, value: value as T } : { ok: false, errors: describe(result.errors) };
  };
}

// Keywords that only report that something nested failed; the nested error says what.
const WRAPPERS = new Set([
  "properties",
  "additionalProperties",
  "items",
  "prefixItems",
  "$ref",
  "allOf",
  "oneOf",
  "anyOf",
]);

// What @cfworker/json-schema says when `additionalProperties: false` refuses a property. It also
// says it about declared properties whose own check failed, so it is kept only when nothing more
// specific is reported at or below that location.
const REFUSED = "False boolean schema.";

function describe(units: OutputUnit[]): string[] {
  const located = units
    .filter((unit) => !WRAPPERS.has(unit.keyword))
    .map((unit) => ({ at: unit.instanceLocation.replace(/^#/, "") || "/", error: unit.error }));
  const lines = located.flatMap(({ at, error }) => {
    if (error !== REFUSED) return [`${at} ${error.replace(/^Instance /, "")}`];
    const explained = located.some(
      (other) => other.error !== REFUSED && (other.at === at || other.at.startsWith(`${at}/`)),
    );
    return explained ? [] : [`${at} is not an allowed field.`];
  });
  return lines.length > 0 ? [...new Set(lines)] : ["/ does not match the schema."];
}
