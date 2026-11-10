#!/usr/bin/env bash
# Base setup for the A-Zee staging host on Oracle Linux 9 / aarch64 (VM.Standard.A1.Flex). REVIEW IT BEFORE RUNNING; it is NOT run by anything automatically.
#   ALLOW_SSH_CIDR=203.0.113.7/32 ./bootstrap-a1.sh            # apply
#   DRY_RUN=1 ALLOW_SSH_CIDR=203.0.113.7/32 ./bootstrap-a1.sh   # print what would change
# Properties: idempotent; refuses to run on another CPU architecture, as root, or without ALLOW_SSH_CIDR; the only inbound port ever opened is SSH,
# and only from ALLOW_SSH_CIDR; PostgreSQL listens on loopback only; no remote script is piped into a shell; nothing is deleted; secrets are never written.
set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"
NODE_STREAM="${NODE_STREAM:-22}"                 # AppStream nodejs module stream; confirm with: dnf module list nodejs
PG_STREAM="${PG_STREAM:-16}"                     # AppStream postgresql module stream (the certified version)
SWAP_SIZE_GB="${SWAP_SIZE_GB:-2}"
run() { if [ "$DRY_RUN" = "1" ]; then echo "DRY-RUN: $*"; else echo "+ $*"; "$@"; fi; }
note() { printf '\n== %s\n' "$*"; }

[ "$(uname -m)" = "aarch64" ] || { echo "REFUSING: this script is for aarch64 (A1 Flex); this machine is $(uname -m)"; exit 2; }
[ "$(id -u)" -ne 0 ] || { echo "REFUSING: run as a normal sudo-capable user (for example opc), not root"; exit 2; }
[ -n "${ALLOW_SSH_CIDR:-}" ] || { echo "REFUSING: set ALLOW_SSH_CIDR to the address range allowed to reach SSH (for example your public IP /32)"; exit 2; }
[[ "$ALLOW_SSH_CIDR" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/([0-9]|[12][0-9]|3[0-2])$ ]] || { echo "REFUSING: ALLOW_SSH_CIDR must look like 203.0.113.7/32"; exit 2; }
[ "$ALLOW_SSH_CIDR" != "0.0.0.0/0" ] || { echo "REFUSING: SSH must not be open to the whole internet"; exit 2; }
grep -q 'Oracle Linux Server release 9' /etc/oracle-release 2>/dev/null || { echo "REFUSING: Oracle Linux 9 expected"; exit 2; }
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo); [ "$mem_mb" -ge 8000 ] || { echo "REFUSING: only ${mem_mb} MB RAM; the A1 target is 12 GB"; exit 2; }

note "1. swap file (${SWAP_SIZE_GB} GB, a safety net; the host has plenty of RAM)"
if [ ! -e /swapfile ]; then
  run sudo fallocate -l "${SWAP_SIZE_GB}G" /swapfile
  run sudo chmod 600 /swapfile
  run sudo mkswap /swapfile
  run sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || { [ "$DRY_RUN" = "1" ] && echo "DRY-RUN: add swap line to /etc/fstab" || echo '/swapfile none swap defaults 0 0' | sudo tee -a /etc/fstab >/dev/null; }
else echo "/swapfile exists; left untouched"; fi

note "2. packages (Oracle AppStream only; nothing is downloaded and executed)"
run sudo dnf -y module enable "nodejs:${NODE_STREAM}" "postgresql:${PG_STREAM}"
run sudo dnf -y install nodejs postgresql-server postgresql openssl git firewalld chrony tar
run sudo systemctl enable --now chronyd

note "3. service account and directories (no login shell; secrets directory is 0700 and empty)"
getent passwd azee >/dev/null || run sudo useradd --system --home-dir /var/lib/azee --create-home --shell /sbin/nologin azee
run sudo install -d -o azee -g azee -m 0750 /opt/azee /var/lib/azee/logs
run sudo install -d -o root -g azee -m 0750 /etc/azee
run sudo install -d -o azee -g azee -m 0700 /etc/azee/secrets

note "4. PostgreSQL ${PG_STREAM}: loopback only, SCRAM only, data on the boot volume"
if [ ! -d /var/lib/pgsql/data/base ]; then run sudo postgresql-setup --initdb; fi
if [ "$DRY_RUN" != "1" ]; then
  sudo install -d -o postgres -g postgres -m 0700 /var/lib/pgsql/data/conf.d 2>/dev/null || true
  sudo tee /var/lib/pgsql/data/conf.d/azee.conf >/dev/null <<'PGCONF'
listen_addresses = '127.0.0.1'
port = 5432
password_encryption = scram-sha-256
shared_buffers = 1GB
max_connections = 100
log_min_messages = warning
PGCONF
  grep -q "include_dir = 'conf.d'" /var/lib/pgsql/data/postgresql.conf || echo "include_dir = 'conf.d'" | sudo tee -a /var/lib/pgsql/data/postgresql.conf >/dev/null
  sudo tee /var/lib/pgsql/data/pg_hba.conf >/dev/null <<'HBA'
# loopback only, password (SCRAM) required for everything; no 'trust', no remote hosts
local   all   postgres                 peer
local   all   all                      scram-sha-256
host    all   all   127.0.0.1/32       scram-sha-256
host    all   all   ::1/128            scram-sha-256
HBA
  sudo chown postgres:postgres /var/lib/pgsql/data/pg_hba.conf /var/lib/pgsql/data/conf.d/azee.conf; sudo chmod 600 /var/lib/pgsql/data/pg_hba.conf
else echo "DRY-RUN: write conf.d/azee.conf (listen_addresses=127.0.0.1) and a loopback-only SCRAM pg_hba.conf"; fi
run sudo systemctl enable --now postgresql

note "5. firewall: SSH from ${ALLOW_SSH_CIDR} only; every other inbound port stays closed"
run sudo systemctl enable --now firewalld
run sudo firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address=${ALLOW_SSH_CIDR} service name=ssh accept"
run sudo firewall-cmd --permanent --remove-service=ssh
run sudo firewall-cmd --reload

note "6. sshd hardening (validated with sshd -t before it is reloaded)"
if [ "$DRY_RUN" != "1" ]; then
  sudo tee /etc/ssh/sshd_config.d/60-azee-hardening.conf >/dev/null <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 3
LoginGraceTime 20
ClientAliveInterval 30
ClientAliveCountMax 3
X11Forwarding no
SSHD
  sudo sshd -t && sudo systemctl reload sshd
else echo "DRY-RUN: write /etc/ssh/sshd_config.d/60-azee-hardening.conf, run sshd -t, reload sshd"; fi

note "7. verification (read-only)"
echo "arch: $(uname -m)   RAM: ${mem_mb} MB   node: $(node -v 2>/dev/null || echo n/a)   postgres: $(postgres --version 2>/dev/null || echo n/a)"
echo "listening sockets (expect only sshd on :22 and postgres on 127.0.0.1:5432):"; ss -tlnp 2>/dev/null | awk 'NR==1 || /:22 |:5432 /'
echo "firewall: $(sudo firewall-cmd --list-all 2>/dev/null | grep -E 'services|rich rules' -A1 | tr '\n' ' ')"
echo "DONE. Keep this SSH session open and open a SECOND session to confirm you can still log in before closing it."
