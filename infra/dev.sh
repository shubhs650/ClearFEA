#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# `make dev`: the API (wrangler dev, :8787), the web app (Vite, :5173) and the
# worker container in one terminal. Ctrl-C stops all three. If any one of them
# exits, the others are stopped too, so a failure is never hidden behind the rest.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '[dev] %s\n' "$*"; }
die() { printf '[dev] %s\n' "$*" >&2; exit 1; }

# --- Checks before anything starts ---------------------------------------------

[ -d node_modules ] || die "Dependencies are not installed. Run 'make install' first."

command -v docker >/dev/null 2>&1 ||
  die "Docker is not installed. The worker runs in a container: install Docker (Docker Desktop on macOS and Windows) and run 'make dev' again."
docker info >/dev/null 2>&1 ||
  die "Cannot reach the Docker daemon. Start Docker Desktop, or on Linux start the daemon (for example 'sudo systemctl start docker'; in the Claude Code cloud environment 'nohup dockerd > /tmp/dockerd.log 2>&1 &', see ADR-012), then run 'make dev' again."

port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for port in 8787 5173; do
  if port_in_use "$port"; then
    die "Port $port is already in use, probably by an earlier 'make dev' or 'pnpm dev'. Stop that process and run 'make dev' again."
  fi
done

if [ ! -f apps/api/.dev.vars ]; then
  cp apps/api/.dev.vars.example apps/api/.dev.vars
  say "Created apps/api/.dev.vars from .dev.vars.example (local worker token)."
fi
# The worker must send the token the API expects (ADR-016), so take it from one place.
worker_token=$(sed -n 's/^WORKER_TOKEN=//p' apps/api/.dev.vars | tail -n 1)
[ -n "$worker_token" ] || die "apps/api/.dev.vars has no WORKER_TOKEN line. Copy it from apps/api/.dev.vars.example."
export CLEARFEA_WORKER_TOKEN="$worker_token"

# Docker Desktop forwards host.docker.internal to services on the host's loopback;
# Docker Engine on Linux does not, so there the worker shares the host network (ADR-016).
compose=(docker compose -f infra/docker-compose.yml)
if [ "$(uname -s)" = Linux ] && ! docker info --format '{{.OperatingSystem}}' 2>/dev/null | grep -q 'Docker Desktop'; then
  compose+=(-f infra/docker-compose.linux.yml)
fi

# --- Start ---------------------------------------------------------------------

# Each service runs as its own job (process group), so it can be stopped as a whole
# and Ctrl-C reaches only this script, which then stops everything in order.
set -m
pids=()

run() {
  local name=$1
  shift
  "$@" </dev/null 2>&1 | sed -u "s/^/[$name] /" &
  pids+=("$(jobs -p %%)")
}

stopping=0
notice=
cleanup() {
  [ "$stopping" = 1 ] && return
  stopping=1
  trap - INT TERM
  say "Stopping."
  {
    for pid in "${pids[@]}" ${notice:+"$notice"}; do
      kill -TERM -- "-$pid" || true
    done
    "${compose[@]}" stop worker >/dev/null || true
    wait || true
  } 2>/dev/null
}
trap cleanup EXIT
trap 'exit 130' INT TERM

say "Starting the API, the web app and the worker. Ctrl-C stops all three."
run api pnpm --filter @clearfea/api dev
run web pnpm --filter @clearfea/web dev
run worker "${compose[@]}" up --build worker

# Say once where to look when the API and web app answer.
(
  for _ in $(seq 1 120); do
    if curl -fsS -o /dev/null http://127.0.0.1:8787/api/health 2>/dev/null &&
      curl -fsS -o /dev/null http://127.0.0.1:5173/ 2>/dev/null; then
      say "Ready: open http://localhost:5173 (API on http://localhost:8787)."
      exit 0
    fi
    sleep 1
  done
  say "The API or the web app has not answered after two minutes; check the [api] and [web] lines above."
) &
notice=$!

set +e
wait -n "${pids[@]}"
status=$?
say "A service exited (status $status); see its last lines above."
exit "$status"
