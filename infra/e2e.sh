#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# `make e2e`: the browser end-to-end tests (apps/web/e2e, docs/VERIFICATION.md).
# Starts a fresh API on :8789 and a worker container (infra/stack.sh) and the web app's dev
# server on :5174 in front of it, writes the test model, runs Playwright, and stops everything.
# It does not touch the state of `make dev` or `make verify`, which can run beside it.
#
#   E2E_API_PORT (default 8789), E2E_WEB_PORT (default 5174); extra arguments go to Playwright.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '[e2e] %s\n' "$*"; }
die() { printf '[e2e] %s\n' "$*" >&2; exit 1; }

port=${E2E_API_PORT:-8789} port_var=E2E_API_PORT
web_port=${E2E_WEB_PORT:-5174}
project=clearfea-e2e
# shellcheck source=infra/stack.sh
. infra/stack.sh
stack_checks
stack_port_free "$web_port" E2E_WEB_PORT
playwright=(pnpm --silent --filter @clearfea/web exec playwright)

state=$(mktemp -d "${TMPDIR:-/tmp}/clearfea-e2e-state.XXXXXX")
out=${E2E_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/clearfea-e2e.XXXXXX")}
mkdir -p "$out" && out=$(cd "$out" && pwd) # Playwright runs from apps/web

say "Writing the test model."
uv run --project worker --locked python apps/web/e2e/block.py "$out/block.step" >"$out/model.log" 2>&1 ||
  die "Writing the test model with Gmsh failed; see $out/model.log."

stack_start

say "Starting the web app on :$web_port."
CLEARFEA_API_ORIGIN="http://127.0.0.1:$port" pnpm --silent --filter @clearfea/web exec \
  vite --host 127.0.0.1 --port "$web_port" --strictPort </dev/null >"$out/web.log" 2>&1 &
pids+=("$(jobs -p %%)")
for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "http://127.0.0.1:$web_port/api/health" 2>/dev/null && break
  sleep 1
done
curl -fsS -o /dev/null "http://127.0.0.1:$web_port/api/health" 2>/dev/null ||
  die "The web app has not answered on :$web_port after a minute; see $out/web.log."

say "Running the browser tests (report and traces in $out)."
CLEARFEA_E2E_URL="http://127.0.0.1:$web_port" CLEARFEA_E2E_MODEL="$out/block.step" CLEARFEA_E2E_OUT="$out" \
  "${playwright[@]}" test "$@"
