# SPDX-License-Identifier: AGPL-3.0-or-later
# Sourced by infra/verify.sh and infra/e2e.sh: a fresh API (wrangler dev with its own empty local
# state, seeded test users) and a worker container pointed at it, both stopped when the script
# exits. It does not touch the state of `make dev`, which can keep running beside it.
#
# The caller defines say() and die(), and sets:
#   port     the API's port, and port_var the variable that sets it (named when the port is taken)
#   project  the Compose project name of the worker container
#   state    an empty temporary folder for the API's local D1 and R2 (removed on exit)
#   out      the folder for api.log and worker.log
# then calls stack_checks, stack_start, and anything else it runs in the background is added to pids.

stack_checks() {
  [ -d node_modules ] || die "Dependencies are not installed. Run 'make install' first."
  command -v docker >/dev/null 2>&1 ||
    die "Docker is not installed. The worker runs in a container: install Docker and run the command again."
  docker info >/dev/null 2>&1 ||
    die "Cannot reach the Docker daemon. Start it (in the Claude Code cloud environment 'nohup dockerd > /tmp/dockerd.log 2>&1 &', see ADR-012), then run the command again."
  stack_port_free "$port" "$port_var"

  if [ ! -f apps/api/.dev.vars ]; then
    cp apps/api/.dev.vars.example apps/api/.dev.vars
    say "Created apps/api/.dev.vars from .dev.vars.example (local worker token)."
  fi
  grep -q '^SESSION_SECRET=' apps/api/.dev.vars ||
    die "apps/api/.dev.vars has no SESSION_SECRET line. Run 'make dev' once, or copy it from .dev.vars.example."
  grep -q '^ADMIN_EMAIL=alice@clearfea.test$' apps/api/.dev.vars ||
    die "apps/api/.dev.vars does not make alice the admin, which the tests expect. Run 'make dev' once, or add ADMIN_EMAIL=alice@clearfea.test."
  worker_token=$(sed -n 's/^WORKER_TOKEN=//p' apps/api/.dev.vars | tail -n 1)
  [ -n "$worker_token" ] || die "apps/api/.dev.vars has no WORKER_TOKEN line. Copy it from apps/api/.dev.vars.example."
}

# Fails if something already listens on port $1; $2 is the variable that chooses another.
stack_port_free() {
  if (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; then
    die "Port $1 is in use, probably by an earlier run of this command. Stop it, or set $2."
  fi
}

stack_start() {
  # The worker reaches the API on the host as `make dev`'s does (ADR-016): host networking
  # on Docker Engine for Linux, host.docker.internal on Docker Desktop.
  compose=(docker compose -p "$project" -f infra/docker-compose.yml)
  local api_for_worker="http://host.docker.internal:$port"
  if [ "$(uname -s)" = Linux ] && ! docker info --format '{{.OperatingSystem}}' 2>/dev/null | grep -q 'Docker Desktop'; then
    compose+=(-f infra/docker-compose.linux.yml)
    api_for_worker="http://127.0.0.1:$port"
  fi
  export CLEARFEA_API_URL="$api_for_worker" CLEARFEA_WORKER_TOKEN="$worker_token" CLEARFEA_WORKER_ID="$project-worker"
  CLEARFEA_COMMIT=$(git describe --always --dirty 2>/dev/null || true)
  export CLEARFEA_COMMIT

  set -m
  pids=()
  trap stack_stop EXIT
  trap 'exit 130' INT TERM

  local wrangler=(pnpm --silent --filter @clearfea/api exec wrangler)
  say "Preparing a fresh local database in $state."
  "${wrangler[@]}" d1 migrations apply DB --local --persist-to "$state" >"$out/api.log" 2>&1 ||
    die "Applying the migrations failed; see $out/api.log."
  "${wrangler[@]}" d1 execute DB --local --persist-to "$state" --file seed/test-users.sql >>"$out/api.log" 2>&1 ||
    die "Seeding the test users failed; see $out/api.log."
  # Every case and browser test runs as alice in one day, more runs than one user may start
  # (M11.3, ADR-112); the other queue limits stay as on the live site.
  "${wrangler[@]}" d1 execute DB --local --persist-to "$state" \
    --command "UPDATE settings SET value = 1000 WHERE name = 'runs_per_user_per_day'" >>"$out/api.log" 2>&1 ||
    die "Raising the daily run limit failed; see $out/api.log."

  say "Starting the API on :$port and the worker container (logs in $out)."
  "${wrangler[@]}" dev --port "$port" --persist-to "$state" </dev/null >>"$out/api.log" 2>&1 &
  pids+=("$(jobs -p %%)")
  "${compose[@]}" up --build worker </dev/null >"$out/worker.log" 2>&1 &
  local worker_pid
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
    curl -fsS -o /dev/null "http://127.0.0.1:$port/api/health" 2>/dev/null && return 0
    sleep 1
  done
  die "The API has not answered on :$port after two minutes; see $out/api.log."
}

stack_stop() {
  trap - EXIT INT TERM
  {
    for pid in "${pids[@]}"; do kill -TERM -- "-$pid" || true; done
    "${compose[@]}" down >/dev/null || true
    wait || true
  } 2>/dev/null
  rm -rf "$state"
}
