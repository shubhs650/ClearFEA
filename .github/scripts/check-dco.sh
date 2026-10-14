#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Checks that every commit in a range carries a DCO sign-off by its author (see CONTRIBUTING.md).
# Usage: .github/scripts/check-dco.sh <base> <head>
# Merge commits are skipped. The sign-off must match the commit's author name and email exactly.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <base> <head>" >&2
  exit 2
fi

failed=0
checked=0
while read -r sha; do
  [[ -z "$sha" ]] && continue
  checked=$((checked + 1))
  author="$(git log -1 --format='%an <%ae>' "$sha")"
  if git log -1 --format='%(trailers:key=Signed-off-by,valueonly)' "$sha" | grep -qxF "$author"; then
    echo "ok       $(git log -1 --format='%h %s' "$sha")"
  else
    echo "missing  $(git log -1 --format='%h %s' "$sha")"
    echo "         expected: Signed-off-by: $author"
    failed=$((failed + 1))
  fi
done < <(git rev-list --no-merges "$1..$2")

if [[ $failed -gt 0 ]]; then
  echo
  echo "$failed of $checked commits have no sign-off from their author."
  echo "Add one with \`git commit --amend -s\` for the last commit, or"
  echo "\`git rebase --signoff $1\` for all of them, then push again."
  echo "CONTRIBUTING.md explains what the sign-off certifies."
  exit 1
fi
echo "All $checked commits are signed off by their authors."
