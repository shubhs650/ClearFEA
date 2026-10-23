#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The VPS benchmark (M12.6): runs the job-step benchmark (worker/benchmarks/solver/steps.py), the
# light lane's mesh benchmark (mesh.py) and PaStiX's thread scaling (bench.py) on the solver VPS,
# each case in a container from the image the manager runs, pinned and limited like the lane it
# measures (the lane settings of /etc/clearfea/manager.env). The results are fitted on a
# development machine (fit.py), not here.
#
# Run as root from a copy of the whole repository on the VPS (docs/DEPLOYMENT.md section 4.3):
#
#   bash infra/vps/benchmark.sh start    start it in the background (the unit clearfea-benchmark);
#                                        logging out does not stop it
#   bash infra/vps/benchmark.sh status   how far it is, and the last lines of its log
#   bash infra/vps/benchmark.sh stop     stop it; start again goes on after the last finished case
#   bash infra/vps/benchmark.sh run      run it in this terminal (what the unit runs)
#
# Everything goes to /var/lib/clearfea-benchmark (CLEARFEA_BENCHMARK_DIR); the results are the
# JSON files in its results folder. Nothing here changes the manager, its settings or its image.
set -euo pipefail

UNIT=clearfea-benchmark
SCRIPT=$(readlink -f "${BASH_SOURCE[0]}")
SRC=$(cd "$(dirname "$SCRIPT")/../.." && pwd)
OUT=${CLEARFEA_BENCHMARK_DIR:-/var/lib/clearfea-benchmark}
ENV_FILE=${CLEARFEA_ENV_FILE:-/etc/clearfea/manager.env}
IMAGE_TAG=clearfea-benchmark:image

# What is measured, in order, one case per line: the light lane's meshes first (an hour or so),
# PaStiX on 1 to 6 threads, then each solver's linear static meshes, then SPOOLES's modal ones,
# which take longest. The meshes are the committed set of steps.json (ADR-063, ADR-072) and a
# mesh above each direct solver's 16 GiB limit, so the solve lane's limits are not extrapolated.
DEFAULT_CASES=$(cat <<'EOF'
mesh 100000:1
mesh 250000:1
mesh 500000:1
mesh 1000000:1
mesh 2000000:1
mesh 100000:2
mesh 250000:2
mesh 500000:2
mesh 1000000:2
mesh 2000000:2
threads 1
threads 2
threads 4
threads 6
static pastix 3000:2 12000:2 25000:2 50000:2 100000:2 150000:2 170000:2
static pastix 25000:1 100000:1 200000:1 400000:1 800000:1 1000000:1 1200000:1
static spooles 3000:2 12000:2 25000:2 50000:2 100000:2 150000:2 170000:2 190000:2
static spooles 25000:1 100000:1 200000:1 400000:1 500000:1
static iterative_cholesky 3000:2 25000:2 100000:2 250000:2 500000:2
static iterative_cholesky 25000:1 100000:1 400000:1 500000:1
static iterative_scaling 3000:2 25000:2 100000:2 250000:2 500000:2
static iterative_scaling 25000:1 100000:1 400000:1 500000:1
modal 1 3000:2 12000:2 25000:2 50000:2 100000:2 150000:2
modal 1 25000:1 100000:1 200000:1 400000:1 500000:1
modal 10 3000:2 12000:2 25000:2
modal 50 25000:2
modal 100 3000:2 12000:2 25000:2 50000:2 100000:2 150000:2
modal 100 25000:1 100000:1 200000:1 400000:1 500000:1
EOF
)
# A shorter list for a trial, in the same format (CLEARFEA_BENCHMARK_CASES='mesh 100000:1').
CASES=${CLEARFEA_BENCHMARK_CASES:-$DEFAULT_CASES}

die() {
  echo "benchmark: $*" >&2
  exit 1
}

setting() {
  # A NAME=value line of the manager's environment file, or the default.
  local value
  value=$(sed -n "s/^$1=//p" "$ENV_FILE" 2>/dev/null | tail -n 1 | tr -d '[:space:]')
  echo "${value:-$2}"
}

# Each case as one "kind arguments target:order" line, so a finished one can be skipped.
expanded_cases() {
  local kind rest case
  while read -r kind rest; do
    case $kind in
      mesh | threads) echo "$kind $rest" ;;
      static | modal)
        read -r -a words <<<"$rest"
        for case in "${words[@]:1}"; do echo "$kind ${words[0]} $case"; done
        ;;
    esac
  done <<<"$CASES"
}

wait_for_jobs() {
  # A job container of the manager would share the CPUs and memory being measured.
  local said=
  while [ -n "$(docker ps -q --filter label=clearfea.manager.host)" ]; do
    [ -n "$said" ] || echo "benchmark: a job is running on this host; waiting for it to end"
    said=1
    sleep 30
  done
}

run_case() {
  local kind=$1 cpus memory
  shift
  local -a command
  case $kind in
    mesh)
      # On the light lane's CPU, but with the solve lane's memory as room, so a mesh that
      # needs more than the light lane has shows how much it needs instead of being killed.
      cpus=$LIGHT_CPUSET memory=$SOLVE_MEMORY
      command=(benchmarks/solver/mesh.py --out /out/work --results /out/results/mesh.json "$1")
      ;;
    threads)
      cpus=$SOLVE_CPUSET memory=$SOLVE_MEMORY
      command=(benchmarks/solver/bench.py --out /out/threads --results /out/results/threads.json
        --build "image-$TAG" --solvers PASTIX --threads "$1" --targets 100000 150000)
      ;;
    static)
      cpus=$SOLVE_CPUSET memory=$SOLVE_MEMORY
      command=(benchmarks/solver/steps.py --out /out/work --results /out/results/steps.json
        --solver "$1" "$2")
      ;;
    modal)
      cpus=$SOLVE_CPUSET memory=$SOLVE_MEMORY
      command=(benchmarks/solver/steps.py --out /out/work --results /out/results/steps.json
        --solver spooles --analysis modal --modes "$1" "$2")
      ;;
    *) die "unknown case kind $kind" ;;
  esac
  docker run --rm --name "$UNIT-case" --network none \
    --cpuset-cpus "$cpus" --memory "$memory" --memory-swap "$memory" \
    --volume "$SRC/worker/benchmarks:/opt/worker/benchmarks:ro" --volume "$OUT:/out" \
    --workdir /opt/worker --entrypoint python \
    "$IMAGE_TAG" "${command[@]}"
}

run() {
  [ "$(id -u)" = 0 ] || die "run this as root"
  [ -f "$SRC/worker/benchmarks/solver/steps.py" ] || die "no repository copy around $SCRIPT"
  docker image inspect clearfea-worker:current >/dev/null 2>&1 ||
    die "clearfea-worker:current is not loaded; run systemctl start clearfea-image-update first"
  SOLVE_CPUSET=$(setting CLEARFEA_SOLVE_CPUSET 0-5)
  SOLVE_MEMORY=$(setting CLEARFEA_SOLVE_MEMORY 17g)
  LIGHT_CPUSET=$(setting CLEARFEA_LIGHT_CPUSET 6)
  mkdir -p "$OUT"
  # The first run fixes the image every case runs, under a tag of its own, so the image updater
  # neither changes it nor removes it in the middle.
  if ! docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
    docker tag clearfea-worker:current "$IMAGE_TAG"
  fi
  # The image's source tag (src-...), as the updater loaded it, or else its short id.
  local id
  id=$(docker image inspect -f '{{.Id}}' "$IMAGE_TAG")
  TAG=$(docker image ls --no-trunc clearfea-worker --format '{{.Tag}} {{.ID}}' |
    awk -v id="$id" '$2 == id && $1 ~ /^src-/ { print $1; exit }')
  [ -n "$TAG" ] || TAG=$(echo "$id" | cut -c 8-19)
  # The job containers' user (uid 10001) writes the work and the results.
  install -d -o 10001 -g 10001 "$OUT/work" "$OUT/threads" "$OUT/results"
  touch "$OUT/done"
  {
    echo "date: $(date -u +%FT%TZ)"
    echo "image: $TAG ($id)"
    echo "solve lane: CPUs $SOLVE_CPUSET, $SOLVE_MEMORY; light lane: CPU $LIGHT_CPUSET"
    grep -E '^(PRETTY_NAME)=' /etc/os-release
    uname -r
    nproc
    free -b
    lscpu
  } >"$OUT/results/host.txt"

  local total done=0 failed=0 line
  total=$(expanded_cases | wc -l)
  echo "benchmark: $total cases, image $TAG, solve lane CPUs $SOLVE_CPUSET with $SOLVE_MEMORY"
  while read -r line; do
    if grep -qxF "$line" "$OUT/done"; then
      done=$((done + 1))
      continue
    fi
    wait_for_jobs
    echo "benchmark: [$((done + failed + 1))/$total] $line ($(date -u +%H:%M) UTC)"
    # shellcheck disable=SC2086  # the case's words are its arguments
    if run_case $line; then
      echo "$line" >>"$OUT/done"
      done=$((done + 1))
    else
      echo "benchmark: FAILED $line (exit $?); going on with the next case"
      failed=$((failed + 1))
    fi
  done < <(expanded_cases)
  echo "benchmark: finished, $done of $total cases done, $failed failed ($(date -u +%H:%M) UTC)"
  if [ "$failed" = 0 ]; then
    rm -rf "$OUT/work" "$OUT/threads"
    docker image rm "$IMAGE_TAG" >/dev/null 2>&1 || true
  fi
  echo "benchmark: the results are in $OUT/results"
}

case ${1:-} in
  start)
    [ "$(id -u)" = 0 ] || die "run this as root"
    if systemctl is-active --quiet "$UNIT"; then die "already running; see: bash $SCRIPT status"; fi
    systemctl reset-failed "$UNIT" >/dev/null 2>&1 || true
    mkdir -p "$OUT"
    systemd-run --unit "$UNIT" --description "ClearFEA VPS benchmark (M12.6)" \
      --property StandardOutput="append:$OUT/benchmark.log" \
      --property StandardError="append:$OUT/benchmark.log" \
      /bin/bash "$SCRIPT" run
    echo "Started. You may log out; it runs about 12 to 15 hours. Progress: bash $SCRIPT status"
    ;;
  status)
    if systemctl is-active --quiet "$UNIT"; then echo "Running."; else echo "Not running."; fi
    [ -f "$OUT/done" ] && echo "Cases finished: $(wc -l <"$OUT/done") of $(expanded_cases | wc -l)"
    [ -f "$OUT/benchmark.log" ] && tail -n 15 "$OUT/benchmark.log"
    ;;
  stop)
    systemctl stop "$UNIT" 2>/dev/null || true
    docker rm --force "$UNIT-case" >/dev/null 2>&1 || true
    echo "Stopped. bash $SCRIPT start goes on after the last finished case."
    ;;
  run) run ;;
  *)
    echo "usage: bash $SCRIPT start|status|stop|run" >&2
    exit 2
    ;;
esac
