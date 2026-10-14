#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Generates Pydantic models from packages/spec/schemas into worker/clearfea_worker/spec/.
# Usage: packages/spec/scripts/generate-python.sh [--check]
# With --check nothing is written; the script fails if the generated models are out of date.
set -euo pipefail

repo="$(cd "$(dirname "$0")/../../.." && pwd)"
target="$repo/worker/clearfea_worker/spec"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

header="# SPDX-License-Identifier: AGPL-3.0-or-later
# Generated from packages/spec/schemas by packages/spec/scripts/generate-python.sh.
# Do not edit by hand; change the schema and run \`make spec\`."

run() { uv run --quiet --directory "$repo/worker" --locked "$@"; }

run datamodel-codegen \
  --input "$repo/packages/spec/schemas" --input-file-type jsonschema \
  --output "$scratch/spec" \
  --output-model-type pydantic_v2.BaseModel --target-python-version 3.12 \
  --enum-field-as-literal all --use-type-alias --snake-case-field --allow-population-by-field-name \
  --use-annotated --field-constraints --use-standard-collections --use-union-operator \
  --use-schema-description --use-field-description --use-double-quotes \
  --disable-timestamp --custom-file-header "$header" --formatters builtin
run ruff check --quiet --config "$repo/worker/pyproject.toml" --fix --select I "$scratch/spec"
run ruff format --quiet --config "$repo/worker/pyproject.toml" "$scratch/spec"

if [[ "${1:-}" == "--check" ]]; then
  if ! diff -r --exclude=__pycache__ "$scratch/spec" "$target" > /dev/null 2>&1; then
    echo "Pydantic models in worker/clearfea_worker/spec are out of date. Run \`make spec\` and commit the result." >&2
    exit 1
  fi
  echo "Pydantic models match the schemas."
else
  rm -rf "$target"
  cp -r "$scratch/spec" "$target"
  echo "Wrote Pydantic models to worker/clearfea_worker/spec."
fi
