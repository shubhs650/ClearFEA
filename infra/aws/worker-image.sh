#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The AWS side of deploying the solver (worker) image, run by .github/workflows/deploy.yml
# (M10.8, ADR-095 item 9, ADR-101) after it has signed in to AWS. Needs the AWS CLI and jq.
#
#   worker-image.sh stack NAME          print the stack's image store as repository_uri=... and
#                                       repository=... lines (for $GITHUB_OUTPUT)
#   worker-image.sh tag                 print the image tag for this checkout's solver source
#   worker-image.sh find REPO TAG       print the digest of REPO:TAG, or nothing if it is not there
#   worker-image.sh latest REPO DIGEST  point REPO:latest at DIGEST
#   worker-image.sh register IMAGE      register a revision of each machine definition that runs
#                                       IMAGE (repository@digest); the API starts the newest one
#
# The tag names the source, not the commit: a merge that changes neither worker/ nor
# packages/spec/ finds its image already pushed and builds nothing, and a run from an older tag
# (DEPLOYMENT.md section 7.2) finds that tag's image again.
set -euo pipefail

# The machine definitions of infra/aws/clearfea.yaml. Large exists only while LargeSizeEnabled
# is true; standard must exist.
FAMILIES=(clearfea-standard clearfea-large)
REQUIRED_FAMILY=clearfea-standard
CONTAINER=worker

die() {
  echo "::error::$*" >&2
  exit 1
}

cmd_stack() {
  local stack=$1 uri
  uri=$(aws cloudformation describe-stacks --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='WorkerRepositoryUri'].OutputValue | [0]" --output text) ||
    die "Could not read the AWS stack '$stack'. Create it from infra/aws/clearfea.yaml as docs/DEPLOYMENT.md section 4.3 says, in the region of the AWS_REGION variable."
  [ -n "$uri" ] && [ "$uri" != "None" ] || die "The AWS stack '$stack' has no WorkerRepositoryUri output. Update it with the current infra/aws/clearfea.yaml (docs/DEPLOYMENT.md section 4.3)."
  echo "repository_uri=$uri"
  echo "repository=${uri#*/}"
}

cmd_tag() {
  local worker spec
  worker=$(git rev-parse HEAD:worker)
  spec=$(git rev-parse HEAD:packages/spec)
  echo "src-$(printf '%s %s\n' "$worker" "$spec" | sha256sum | cut -c1-20)"
}

cmd_find() {
  local repo=$1 tag=$2 out err
  err=$(mktemp)
  if out=$(aws ecr describe-images --repository-name "$repo" --image-ids "imageTag=$tag" \
    --query 'imageDetails[0].imageDigest' --output text 2>"$err"); then
    rm -f "$err"
    [ "$out" = "None" ] || echo "$out"
    return 0
  fi
  if grep -q ImageNotFoundException "$err"; then
    rm -f "$err"
    return 0
  fi
  cat "$err" >&2
  rm -f "$err"
  die "Could not look up $repo:$tag in the image store."
}

cmd_latest() {
  local repo=$1 digest=$2 image err
  image=$(aws ecr batch-get-image --repository-name "$repo" --image-ids "imageDigest=$digest" \
    --query 'images[0]' --output json)
  [ "$(jq -r '.imageManifest // empty' <<<"$image")" ] || die "$repo@$digest is not in the image store."
  err=$(mktemp)
  if aws ecr put-image --repository-name "$repo" --image-tag latest \
    --image-manifest "$(jq -r .imageManifest <<<"$image")" \
    --image-manifest-media-type "$(jq -r .imageManifestMediaType <<<"$image")" \
    >/dev/null 2>"$err"; then
    echo "$repo:latest is now $digest"
  elif grep -q ImageAlreadyExistsException "$err"; then
    echo "$repo:latest was already $digest"
  else
    cat "$err" >&2
    rm -f "$err"
    die "Could not tag $repo@$digest as latest."
  fi
  rm -f "$err"
}

# The new revision copies the newest one, whoever registered it (this script or a stack update),
# and changes only the worker's image. A machine already running keeps the image it started with.
new_revision() {
  jq --arg container "$CONTAINER" --arg image "$1" '
    del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities,
        .registeredAt, .registeredBy, .deregisteredAt)
    | .containerDefinitions |= map(if .name == $container then .image = $image else . end)'
}

cmd_register() {
  local image=$1 family current running file err arn
  [[ $image == *@sha256:* ]] || die "register needs an image pinned by digest (repository@sha256:...), not '$image'."
  for family in "${FAMILIES[@]}"; do
    err=$(mktemp)
    if ! current=$(aws ecs describe-task-definition --task-definition "$family" \
      --query taskDefinition --output json 2>"$err"); then
      if grep -q "Unable to describe task definition" "$err" && [ "$family" != "$REQUIRED_FAMILY" ]; then
        echo "$family: not defined in the stack (LargeSizeEnabled is false), skipped"
        rm -f "$err"
        continue
      fi
      cat "$err" >&2
      rm -f "$err"
      die "Could not read the machine definition $family. Check the AWS stack exists (docs/DEPLOYMENT.md section 4.3)."
    fi
    rm -f "$err"
    running=$(jq -r --arg container "$CONTAINER" \
      '.containerDefinitions[] | select(.name == $container) | .image' <<<"$current")
    [ -n "$running" ] || die "The machine definition $family has no container named $CONTAINER."
    if [ "$running" = "$image" ]; then
      echo "$family: the newest revision already runs $image"
      continue
    fi
    file=$(mktemp)
    new_revision "$image" <<<"$current" >"$file"
    arn=$(aws ecs register-task-definition --cli-input-json "file://$file" \
      --query taskDefinition.taskDefinitionArn --output text)
    rm -f "$file"
    echo "$family: registered $arn (was $running)"
  done
}

[ $# -ge 1 ] || die "usage: worker-image.sh stack|tag|find|latest|register ..."
command=$1
shift
case "$command" in
  stack) [ $# -eq 1 ] || die "usage: worker-image.sh stack NAME"; cmd_stack "$@" ;;
  tag) [ $# -eq 0 ] || die "usage: worker-image.sh tag"; cmd_tag ;;
  find) [ $# -eq 2 ] || die "usage: worker-image.sh find REPOSITORY TAG"; cmd_find "$@" ;;
  latest) [ $# -eq 2 ] || die "usage: worker-image.sh latest REPOSITORY DIGEST"; cmd_latest "$@" ;;
  register) [ $# -eq 1 ] || die "usage: worker-image.sh register IMAGE"; cmd_register "$@" ;;
  *) die "unknown command '$command'; use stack, tag, find, latest or register" ;;
esac
