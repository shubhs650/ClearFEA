#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The R2 side of the deploy workflow's Worker image job (M12.5, ADR-110, ADR-131): the worker
# image is kept as a compressed `docker save` archive in the site's bucket, which the solver
# VPS's image updater downloads through a presigned link from the API.
#
#   worker-archive.sh tag              print the image tag for this checkout's solver source
#   worker-archive.sh find TAG         print the SHA-256 of TAG's archive, or nothing if none
#   worker-archive.sh store TAG FILE   upload FILE as TAG's archive, with its SHA-256
#   worker-archive.sh prune KEEP TAG   keep TAG's archive and the KEEP-1 newest others
#
# The tag names the source, not the commit: a merge that changes neither worker/ nor
# packages/spec/ finds its archive already stored and builds nothing, and a run from an older
# tag (DEPLOYMENT.md section 7.2) finds that tag's archive again unless it was pruned, and then
# builds it again. Needs the AWS CLI (which speaks R2's S3 API), git and sha256sum, and
# R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID and R2_BUCKET in the environment.
set -euo pipefail

PREFIX="worker-images/"

die() {
  echo "::error::$*" >&2
  exit 1
}

s3() {
  : "${R2_ACCOUNT_ID:?}" "${R2_BUCKET:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}"
  # R2 takes the S3 API at the account's endpoint in region "auto"; newer AWS CLIs add checksums
  # R2 does not need, so only when an operation requires them.
  AWS_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY AWS_DEFAULT_REGION=auto \
    AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    aws --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" "$@"
}

key() {
  [[ $1 =~ ^src-[0-9a-f]{20}$ ]] || die "$1 is not a worker image tag."
  echo "${PREFIX}$1.tar.gz"
}

cmd_tag() {
  local worker spec
  worker=$(git rev-parse HEAD:worker)
  spec=$(git rev-parse HEAD:packages/spec)
  echo "src-$(printf '%s %s\n' "$worker" "$spec" | sha256sum | cut -c1-20)"
}

cmd_find() {
  local object err
  err=$(mktemp)
  if object=$(s3 s3api head-object --bucket "$R2_BUCKET" --key "$(key "$1")" --output json 2>"$err"); then
    rm -f "$err"
    jq -r '.Metadata.sha256 // empty' <<<"$object"
    return 0
  fi
  if grep -q -e '(404)' -e 'Not Found' "$err"; then
    rm -f "$err"
    return 0
  fi
  cat "$err" >&2
  rm -f "$err"
  die "Could not look for the worker image archive in R2. Check the R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY secrets (docs/DEPLOYMENT.md section 1.7)."
}

cmd_store() {
  local tag=$1 file=$2 sha
  sha=$(sha256sum "$file" | cut -d' ' -f1)
  # R2 shows the object only once the (multipart) upload is complete, and the API offers an
  # archive only with the SHA-256 in its metadata, so the VPS is never handed a partial one.
  s3 s3 cp --only-show-errors --content-type application/gzip --metadata "sha256=$sha" \
    "$file" "s3://$R2_BUCKET/$(key "$tag")"
  [ "$(cmd_find "$tag")" = "$sha" ] || die "The archive of $tag was uploaded but R2 does not show its SHA-256."
  echo "Stored $(key "$tag"): $(stat -c %s "$file") bytes, SHA-256 $sha"
}

cmd_prune() {
  local keep=$1 tag=$2 current old
  current=$(key "$tag")
  s3 s3api list-objects-v2 --bucket "$R2_BUCKET" --prefix "$PREFIX" --output json |
    jq -r --arg current "$current" --argjson keep "$keep" \
      '[.Contents // [] | sort_by(.LastModified) | reverse | .[].Key | select(. != $current)] | .[($keep - 1):] | .[]' |
    while read -r old; do
      s3 s3 rm --only-show-errors "s3://$R2_BUCKET/$old"
      echo "Deleted the old archive $old"
    done
}

command=${1:-}
shift || true
case "$command" in
  tag) cmd_tag ;;
  find) cmd_find "$@" ;;
  store) cmd_store "$@" ;;
  prune) cmd_prune "$@" ;;
  *) die "usage: worker-archive.sh tag | find TAG | store TAG FILE | prune KEEP TAG" ;;
esac
