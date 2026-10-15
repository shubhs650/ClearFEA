#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# `make verify`: runs the verification cases (verification/cases) through the platform.
# Starts a fresh API (wrangler dev on :8788, with its own empty local state) and a worker
# container pointed at it (infra/stack.sh), runs the harness (verification/harness), and stops
# both. It does not touch the state of `make dev`, which can keep running beside it.
#
#   VERIFY_TIER=coarse|full (default coarse), CASES="V-01 V-02" (default all)
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '[verify] %s\n' "$*"; }
die() { printf '[verify] %s\n' "$*" >&2; exit 1; }

tier=${VERIFY_TIER:-coarse}
port=${VERIFY_PORT:-8788} port_var=VERIFY_PORT
case "$tier" in coarse | full) ;; *) die "VERIFY_TIER must be coarse or full, not '$tier'." ;; esac

project=clearfea-verify
# shellcheck source=infra/stack.sh
. infra/stack.sh
stack_checks

state=$(mktemp -d "${TMPDIR:-/tmp}/clearfea-verify-state.XXXXXX")
out=${VERIFY_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/clearfea-verify.XXXXXX")}
mkdir -p "$out"
stack_start

say "Running the $tier tier."
# shellcheck disable=SC2086 # CASES is a space-separated list of case ids
(cd verification && uv run --project ../worker --locked python -m harness \
  --api "http://127.0.0.1:$port" --persist-to "$state" --tier "$tier" --out "$out" ${CASES:-})
