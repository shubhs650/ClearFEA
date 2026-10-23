#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Sets up the solver VPS (M12.5, ADR-106, ADR-110): run once as root on a fresh Contabo Cloud VPS
# with Ubuntu 24.04 or 22.04 LTS, from a copy of this folder (docs/DEPLOYMENT.md section 4.3):
#
#   bash bootstrap.sh
#
# It updates the system and turns on automatic security updates, closes every port but SSH and
# allows SSH by key only, installs Docker from Docker's own packages, writes the manager's
# environment file (asking for the three secrets), installs the image updater and the systemd
# units, loads the worker image the API names and starts the compute manager. Running it again
# is safe: it keeps the environment file and redoes the rest, which is also how an updated copy
# of this folder is installed.
#
# It never creates, orders or restarts a VPS (Shubham, 2026-10-22).
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ENV_DIR=/etc/clearfea
ENV_FILE=$ENV_DIR/manager.env
LIB_DIR=/usr/local/lib/clearfea
UNITS=(clearfea-manager.service clearfea-image-update.service clearfea-image-update.timer)

step() { printf '\n== %s\n' "$*"; }
die() {
  echo "bootstrap: $*" >&2
  exit 1
}

[ "$(id -u)" = 0 ] || die "run it as root (ssh root@<the VPS's IP>, or sudo bash bootstrap.sh)."
for file in update-image.sh manager.env.example "${UNITS[@]}"; do
  [ -f "$HERE/$file" ] || die "$file is missing beside this script; copy the whole infra/vps folder."
done
. /etc/os-release
case "${ID:-} ${VERSION_ID:-}" in
  "ubuntu 24.04" | "ubuntu 22.04") echo "${PRETTY_NAME:-Ubuntu ${VERSION_ID}}" ;;
  *)
    [ "${CLEARFEA_ANY_OS:-}" = 1 ] ||
      die "this is ${PRETTY_NAME:-an unknown system}; the script is written for Ubuntu 24.04 and 22.04 LTS. Reinstall the VPS with Ubuntu 24.04 in Contabo's control panel (it erases the VPS, which holds nothing of record), or set CLEARFEA_ANY_OS=1 to try anyway."
    ;;
esac
export DEBIAN_FRONTEND=noninteractive

step "System updates"
apt-get update -q
apt-get upgrade -y -q
apt-get install -y -q ca-certificates curl jq gnupg ufw unattended-upgrades
# Security updates install themselves every day. The VPS never reboots by itself, since that
# would stop a running solve; reboot by hand when the login message asks for it.
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat >/etc/apt/apt.conf.d/52clearfea-unattended <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
EOF

step "SSH by key only"
# Only once a key is there to log in with, so this never locks you out.
if [ -s /root/.ssh/authorized_keys ] || compgen -G "/home/*/.ssh/authorized_keys" >/dev/null; then
  # sshd takes the first value it reads; files in sshd_config.d are read in name order, so this
  # one wins over the image's own (for example 50-cloud-init.conf).
  cat >/etc/ssh/sshd_config.d/10-clearfea.conf <<'EOF'
# Written by ClearFEA's infra/vps/bootstrap.sh: SSH by key only.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  sshd -t
  systemctl reload ssh
  echo "Password logins are off; log in with your SSH key."
else
  echo "WARNING: no SSH key is installed for root or any user, so password logins stay on." >&2
  echo "Add your public key to /root/.ssh/authorized_keys and run this script again." >&2
fi

step "Firewall: SSH in, everything out"
# The manager only calls out to the API and R2; nothing on the internet calls into the VPS.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

step "Docker"
if ! dpkg -s docker-ce >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME:-noble} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -q
fi
apt-get install -y -q docker-ce docker-ce-cli containerd.io
# Job containers keep running while Docker itself restarts (an update), and logs stay small.
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'EOF'
{
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "3" }
}
EOF
systemctl enable docker
systemctl restart docker
docker version --format 'Docker {{.Server.Version}} (API {{.Server.APIVersion}})'

step "The manager's settings ($ENV_FILE)"
install -d -m 0700 "$ENV_DIR"
[ -f "$ENV_FILE" ] || install -m 0600 "$HERE/manager.env.example" "$ENV_FILE"
chmod 0600 "$ENV_FILE"
# Sets NAME=value in the environment file, replacing the line that has it.
set_setting() {
  local name=$1 value=$2 tmp
  tmp=$(mktemp "$ENV_DIR/.manager.env.XXXXXX")
  grep -v -E "^$name=" "$ENV_FILE" >"$tmp" || true
  printf '%s=%s\n' "$name" "$value" >>"$tmp"
  chmod 0600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}
ask() {
  local name=$1 what=$2 value
  if grep -q -E "^$name=.+" "$ENV_FILE"; then
    echo "$name is set."
    return
  fi
  [ -t 0 ] || die "$name is empty in $ENV_FILE. Run this script in an SSH session to be asked for it, or write it into the file."
  read -r -s -p "$what: " value
  echo
  [ -n "$value" ] || die "$name cannot be empty."
  set_setting "$name" "$value"
}
ask CLEARFEA_WORKER_TOKEN "The WORKER_TOKEN secret (docs/DEPLOYMENT.md section 3; nothing shows as you paste)"
ask CLEARFEA_ACCESS_CLIENT_ID "The Access service token's Client ID, ending in .access (section 1.8)"
ask CLEARFEA_ACCESS_CLIENT_SECRET "The Access service token's Client Secret (section 1.8)"

step "Image updater and systemd units"
install -d -m 0755 "$LIB_DIR"
install -m 0755 "$HERE/update-image.sh" "$LIB_DIR/update-image.sh"
for unit in "${UNITS[@]}"; do
  install -m 0644 "$HERE/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable clearfea-manager.service
systemctl enable --now clearfea-image-update.timer

step "The worker image"
# Loads the image the API names and starts the manager on it. Enabling the timer above already
# started a run, so this one waits for it rather than giving up.
CLEARFEA_IMAGE_WAIT=1 "$LIB_DIR/update-image.sh"
if ! docker image inspect clearfea-worker:current >/dev/null 2>&1; then
  echo
  echo "No worker image is loaded yet (see the message above; journalctl -u clearfea-image-update has more)."
  echo "The updater looks again every 5 minutes and starts the manager once it has loaded one."
  exit 0
fi
systemctl restart clearfea-manager

step "Done"
sleep 15
systemctl --no-pager --lines 0 status clearfea-manager || true
journalctl -u clearfea-manager --no-pager -n 15 || true
echo
echo "The manager is running. Within a minute the dashboard's Overview shows the host online."
echo "Its log: journalctl -u clearfea-manager -f"
