#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# `make verify`: runs the verification cases (verification/cases) through the platform.
# Starts a fresh API (wrangler dev on :8788, with its own empty local state) and a worker
# container pointed at it, runs the harness (verification/harness), and stops both.
# It does not touch the state of `make dev`, which can keep running beside it.
#
#   VERIFY_TIER=coarse|full (default coarse), CASES="V-01 V-02" (default all)
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '[verify] %s\n' "$*"; }
die() { printf '[verify] %s\n' "$*" >&2; exit 1; }

tier=${VERIFY_TIER:-coarse}
port=${VERIFY_PORT:-8788}
case "$tier" in coarse | full) ;; *) die "VERIFY_TIER must be coarse or full, not '$tier'." ;; esac

[ -d node_modules ] || die "Dependencies are not installed. Run 'make install' first."
command -v docker >/dev/null 2>&1 ||
  die "Docker is not installed. The worker runs in a container: install Docker and run 'make verify' again."
docker info >/dev/null 2>&1 ||
  die "Cannot reach the Docker daemon. Start it (in the Claude Code cloud environment 'nohup dockerd > /tmp/dockerd.log 2>&1 &', see ADR-012), then run 'make verify' again."
if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
  die "Port $port is in use, probably by an earlier 'make verify'. Stop it, or set VERIFY_PORT."
fi

if [ ! -f apps/api/.dev.vars ]; then
  cp apps/api/.dev.vars.example apps/api/.dev.vars
  say "Created apps/api/.dev.vars from .dev.vars.example (local worker token)."
fi
grep -q '^SESSION_SECRET=' apps/api/.dev.vars ||
  die "apps/api/.dev.vars has no SESSION_SECRET line. Run 'make dev' once, or copy it from .dev.vars.example."
worker_token=$(sed -n 's/^WORKER_TOKEN=//p' apps/api/.dev.vars | tail -n 1)
[ -n "$worker_token" ] || die "apps/api/.dev.vars has no WORKER_TOKEN line. Copy it from apps/api/.dev.vars.example."

state=$(mktemp -d "${TMPDIR:-/tmp}/clearfea-verify-state.XXXXXX")
out=${VERIFY_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/clearfea-verify.XXXXXX")}

# The worker reaches the API on the host as `make dev`'s does (ADR-016): host networking
# on Docker Engine for Linux, host.docker.internal on Docker Desktop.
compose=(docker compose -p clearfea-verify -f infra/docker-compose.yml)
api_for_worker="http://host.docker.internal:$port"
if [ "$(uname -s)" = Linux ] && ! docker info --format '{{.OperatingSystem}}' 2>/dev/null | grep -q 'Docker Desktop'; then
  compose+=(-f infra/docker-compose.linux.yml)
  api_for_worker="http://127.0.0.1:$port"
fi
export CLEARFEA_API_URL="$api_for_worker" CLEARFEA_WORKER_TOKEN="$worker_token" CLEARFEA_WORKER_ID=verify-worker
CLEARFEA_COMMIT=$(git describe --always --dirty 2>/dev/null || true)
export CLEARFEA_COMMIT

set -m
pids=()
cleanup() {
  trap - EXIT INT TERM
  {
    for pid in "${pids[@]}"; do kill -TERM -- "-$pid" || true; done
    "${compose[@]}" down >/dev/null || true
    wait || true
  } 2>/dev/null
  rm -rf "$state"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

wrangler=(pnpm --silent --filter @clearfea/api exec wrangler)
say "Preparing a fresh local database in $state."
"${wrangler[@]}" d1 migrations apply DB --local --persist-to "$state" >"$out/api.log" 2>&1 ||
  die "Applying the migrations failed; see $out/api.log."
"${wrangler[@]}" d1 execute DB --local --persist-to "$state" --file seed/test-users.sql >>"$out/api.log" 2>&1 ||
  die "Seeding the test users failed; see $out/api.log."

say "Starting the API on :$port and the worker container (logs in $out)."
"${wrangler[@]}" dev --port "$port" --persist-to "$state" </dev/null >>"$out/api.log" 2>&1 &
pids+=("$(jobs -p %%)")
"${compose[@]}" up --build worker </dev/null >"$out/worker.log" 2>&1 &
worker_pid=$(jobs -p %%)
pids+=("$worker_pid")

# The first run builds the worker image, which takes minutes; a failed build ends it at once.
say "Waiting for the worker container (the first run builds its image)."
until [ -n "$("${compose[@]}" ps --status running -q worker 2>/dev/null)" ]; do
  kill -0 "$worker_pid" 2>/dev/null ||
    die "The worker did not start; see $out/worker.log. Behind a TLS-intercepting proxy, pass BUILD_CA (ADR-012)."
  sleep 2
done

for _ in $(seq 1 120); do
  curl -fsS -o /dev/null "http://127.0.0.1:$port/api/health" 2>/dev/null && break
  sleep 1
done
curl -fsS -o /dev/null "http://127.0.0.1:$port/api/health" 2>/dev/null ||
  die "The API has not answered on :$port after two minutes; see $out/api.log."

say "Running the $tier tier."
# shellcheck disable=SC2086 # CASES is a space-separated list of case ids
(cd verification && uv run --project ../worker --locked python -m harness \
  --api "http://127.0.0.1:$port" --persist-to "$state" --tier "$tier" --out "$out" ${CASES:-})
