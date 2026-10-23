#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The solver VPS's image updater (M12.5, ADR-110, ADR-131). Run every 5 minutes by
# clearfea-image-update.timer, once by bootstrap.sh, and by hand at any time:
#
#   update-image.sh
#
# It asks the API which worker image to run (GET /internal/worker-image: the deployed one, or
# CLEARFEA_IMAGE_PIN from manager.env to roll back). When that image is not loaded yet it
# downloads its archive (a compressed `docker save` the deploy stored in R2), checks its size and
# SHA-256, loads it and points clearfea-worker:current at it. Each job starts a fresh container of
# clearfea-worker:current, so the next job runs the new image and a running job is not touched.
# The manager itself runs from the same image: it is started when it is enabled but not running
# (the first image after bootstrap.sh), and restarted onto a new image once no job container
# runs (a restart would not stop a job, ADR-121 item 5, but the job's statistics so far would be
# lost), so it may lag behind while jobs run back to back.
#
# Settings come from the manager's environment file (CLEARFEA_ENV_FILE, default
# /etc/clearfea/manager.env). Needs curl, jq, sha256sum and docker. Exits 0 when the right image
# is loaded or nothing is published yet, 1 on any error, which the timer's next run retries.
set -euo pipefail

ENV_FILE=${CLEARFEA_ENV_FILE:-/etc/clearfea/manager.env}
WORK_DIR=${CLEARFEA_IMAGE_DIR:-/var/lib/clearfea/images}
REPOSITORY=clearfea-worker
CURRENT=$REPOSITORY:current
MANAGER=clearfea-manager
HOST_LABEL=clearfea.manager.host
USER_AGENT="ClearFEA-image-updater/1.0 (+https://github.com/shubhs650/ClearFEA)"

die() {
  echo "update-image: $*" >&2
  exit 1
}

# The value of NAME in the environment file (the last line that sets it), as Docker reads it.
setting() {
  grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true
}

image_id() {
  docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true
}

[ -r "$ENV_FILE" ] || die "Cannot read $ENV_FILE. Run bootstrap.sh first (docs/DEPLOYMENT.md section 4.3)."
API_URL=$(setting CLEARFEA_API_URL)
API_URL=${API_URL%/}
TOKEN=$(setting CLEARFEA_WORKER_TOKEN)
ACCESS_ID=$(setting CLEARFEA_ACCESS_CLIENT_ID)
ACCESS_SECRET=$(setting CLEARFEA_ACCESS_CLIENT_SECRET)
PIN=$(setting CLEARFEA_IMAGE_PIN)
[ -n "$API_URL" ] || die "CLEARFEA_API_URL is not set in $ENV_FILE."
[ -n "$TOKEN" ] || die "CLEARFEA_WORKER_TOKEN is not set in $ENV_FILE. Set it to the WORKER_TOKEN secret (docs/DEPLOYMENT.md section 3)."

# One run at a time: the timer and a run by hand could otherwise load the same archive twice.
# The timer's runs leave it to a run already going; bootstrap.sh sets CLEARFEA_IMAGE_WAIT=1 and
# waits for it, since enabling the timer starts a run at once that may be downloading the image.
mkdir -p "$WORK_DIR"
exec 9>"$WORK_DIR/.lock"
if ! flock -n 9; then
  if [ "${CLEARFEA_IMAGE_WAIT:-}" != 1 ]; then
    echo "update-image: another update is running; leaving it to that one."
    exit 0
  fi
  echo "update-image: waiting for the update already running (it may be downloading the image)"
  flock 9
fi

API_HEADERS=(-A "$USER_AGENT" -H "Authorization: Bearer $TOKEN")
if [ -n "$ACCESS_ID" ] && [ -n "$ACCESS_SECRET" ]; then
  API_HEADERS+=(-H "CF-Access-Client-Id: $ACCESS_ID" -H "CF-Access-Client-Secret: $ACCESS_SECRET")
fi

# Which image to run --------------------------------------------------------------------------
query=""
[ -z "$PIN" ] || query="?tag=$PIN"
answer=$(mktemp)
trap 'rm -f "$answer"' EXIT
status=$(curl -sS --max-time 60 "${API_HEADERS[@]}" -o "$answer" -w '%{http_code} %{content_type}' \
  "$API_URL/internal/worker-image$query") || die "Cannot reach $API_URL. Check the VPS's network."
case "$status" in
  200\ application/json*) ;;
  404\ application/json*)
    if [ -z "$PIN" ]; then
      echo "update-image: no worker image to load yet: $(jq -r '.error // empty' "$answer")"
      exit 0
    fi
    die "the pinned image $PIN cannot be loaded: $(jq -r '.error // empty' "$answer") Clear or correct CLEARFEA_IMAGE_PIN in $ENV_FILE."
    ;;
  401\ *) die "the API refused the worker token. Check CLEARFEA_WORKER_TOKEN in $ENV_FILE against the WORKER_TOKEN secret." ;;
  *json*) die "the API answered $status: $(jq -r '.error // empty' "$answer")" ;;
  *) die "the API answered $status, not JSON: Cloudflare Access probably stopped the request. Check CLEARFEA_ACCESS_CLIENT_ID and CLEARFEA_ACCESS_CLIENT_SECRET in $ENV_FILE (docs/DEPLOYMENT.md section 1.8)." ;;
esac
TAG=$(jq -r .tag "$answer")
BYTES=$(jq -r .bytes "$answer")
SHA256=$(jq -r .sha256 "$answer")
URL=$(jq -r .url "$answer")
[[ $TAG =~ ^src-[0-9a-f]{20}$ ]] || die "the API named an image tag that is not one: $TAG"
IMAGE=$REPOSITORY:$TAG

# Load it, unless it already is ---------------------------------------------------------------
if [ -z "$(image_id "$IMAGE")" ]; then
  archive=$WORK_DIR/$TAG.tar.gz
  rm -f "$WORK_DIR"/*.tar.gz
  # The archive, then the loaded image, which is about three times its size.
  free=$(df --output=avail -B1 "$WORK_DIR" | tail -n 1)
  [ "$free" -gt $((BYTES * 4)) ] || die "only $((free / 1024 ** 3)) GiB free in $WORK_DIR, too little to download and load a $((BYTES / 1024 ** 2)) MiB archive. Free space on the VPS (docs/DEPLOYMENT.md section 7.5)."
  echo "update-image: downloading $IMAGE ($((BYTES / 1024 ** 2)) MiB)"
  # The worker token goes only to the API, never to the presigned R2 link.
  download_headers=(-A "$USER_AGENT")
  [ "${URL#"$API_URL"/}" = "$URL" ] || download_headers=("${API_HEADERS[@]}")
  curl -fsS --retry 3 --retry-all-errors --max-time 21600 "${download_headers[@]}" -o "$archive" "$URL" ||
    die "the download of $IMAGE failed; the next run tries again."
  size=$(stat -c %s "$archive")
  [ "$size" = "$BYTES" ] || die "the archive of $IMAGE has $size bytes, not the $BYTES the API named; the next run downloads it again."
  echo "$SHA256  $archive" | sha256sum --check --quiet - ||
    die "the archive of $IMAGE does not have the SHA-256 the deploy recorded; the next run downloads it again."
  docker load --quiet --input "$archive"
  rm -f "$archive"
  [ -n "$(image_id "$IMAGE")" ] || die "the archive did not hold $IMAGE."
  echo "update-image: loaded $IMAGE"
fi

# Point current at it, and drop the images no container uses -----------------------------------
if [ "$(image_id "$IMAGE")" != "$(image_id "$CURRENT")" ]; then
  docker tag "$IMAGE" "$CURRENT"
  echo "update-image: $CURRENT is now $TAG; the next job runs it"
fi
for old in $(docker image ls --format '{{.Repository}}:{{.Tag}}' "$REPOSITORY" | grep -v -e ":current$" -e ":$TAG$" || true); do
  # Refused while a container still runs it; a later run removes it.
  if docker image rm "$old" >/dev/null 2>&1; then echo "update-image: removed $old"; fi
done
docker image prune --force >/dev/null

# Move the manager onto it once no job runs -----------------------------------------------------
manager_image=$(docker inspect --format '{{.Image}}' "$MANAGER" 2>/dev/null || true)
if [ -z "$manager_image" ]; then
  # Not running: bootstrap.sh enables it before there may be an image to start it from.
  if systemctl is-enabled --quiet "$MANAGER" 2>/dev/null; then
    echo "update-image: starting the manager on $TAG"
    systemctl start "$MANAGER"
  fi
elif [ "$manager_image" != "$(image_id "$CURRENT")" ]; then
  if [ -z "$(docker ps --quiet --filter "label=$HOST_LABEL")" ]; then
    echo "update-image: restarting the manager on $TAG"
    systemctl try-restart "$MANAGER"
  else
    echo "update-image: the manager moves to $TAG once its running jobs have ended"
  fi
fi
