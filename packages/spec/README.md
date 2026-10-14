# packages/spec

The single definition of every shape shared between the web app, the API and the worker, plus the units table.

| Path | Holds |
| --- | --- |
| `schemas/*.schema.json` | JSON Schemas (draft 2020-12). One file per area; a file with several messages keeps each under `$defs`. |
| `units.json` | Quantity kinds, their SI unit, and the factor and offset of every allowed unit. Physics-critical. |
| `fixtures/unit-conversions.json` | Conversions worked out by hand from the unit definitions. Both the TypeScript and the Python unit modules must reproduce them. |
| `src/generated/` | TypeScript types, enum value lists and validators. Generated; do not edit. |
| `src/validate.ts`, `src/units.ts` | The validator helper and the checked units table. |
| `scripts/` | The generators for TypeScript (`generate.mjs`) and for the worker's Pydantic models (`generate-python.sh`, writing `worker/clearfea_worker/spec/`). |

## Changing a shape

1. Edit the schema in `schemas/`.
2. Run `make spec` from the repository root. It regenerates `src/generated/` and `worker/clearfea_worker/spec/`.
3. Commit the schema and the generated files together. `make test` fails if they are out of step.

In TypeScript, import from `@clearfea/spec`: `import { type ClaimRequest, validateClaimRequest } from "@clearfea/spec"`. Each `validateX` returns `{ ok: true, value }` or `{ ok: false, errors }`, with each error naming the field it is about. Validation uses `@cfworker/json-schema`, which works in the browser and in Cloudflare Workers (where code generation with `eval` is not allowed).

In Python, import the models from `clearfea_worker.spec`, for example `from clearfea_worker.spec.jobs_schema import ClaimRequest`. Fields are snake_case in Python and camelCase on the wire; serialise with `model_dump_json(by_alias=True)`.

## Units

A value in unit `u` converts to SI as `value * factor + offset`. Every kind's SI unit is listed with factor 1 and no offset; both loaders refuse the table otherwise. Each unit carries a `definition` saying where its factor comes from. Conversion code lives with its users: `apps/web/src/units/` (display only) and `worker/clearfea_worker/units.py` (the deck generator's path to SI). Neither holds a factor of its own.

To add a unit or a quantity kind, add it to `units.json` with its definition, and add at least one case to `fixtures/unit-conversions.json` with the SI value worked out independently of the table.
