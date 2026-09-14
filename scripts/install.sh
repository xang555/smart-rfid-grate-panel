#!/usr/bin/env bash
# One-command installer for the Smart RFID Gate panel on Ubuntu.
#
# Usage:
#   bash install.sh [--url <tarball-url>] [--port <port>] [--no-service]
#
# Tarball resolution order: a smart-rfid-gate-*.tar.gz next to this script,
# then one in dist/ next to this script's repo root, then --url, then the
# baked-in DEFAULT_URL.
set -euo pipefail

DEFAULT_URL="PASTE_SUPABASE_TARBALL_URL_HERE"
APP_DIR="/opt/smart-rfid-gate"
DATA_DIR="/var/lib/smart-rfid-gate"
SERVICE="smart-rfid-gate"

TARBALL_URL=""
PORT="3000"
NO_SERVICE=0

log() { echo "[install] $*"; }
die() { echo "[install] error: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) TARBALL_URL="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --no-service) NO_SERVICE=1; shift ;;
    --help|-h)
      grep '^# ' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

if [[ $EUID -eq 0 ]]; then
  SUDO=""
  INVOKING_USER="${SUDO_USER:-root}"
else
  SUDO="sudo"
  INVOKING_USER="$(id -un)"
fi

# --- prerequisites ---------------------------------------------------------
if ! command -v curl >/dev/null 2>&1; then
  log "installing curl"
  $SUDO apt-get update -y
  $SUDO apt-get install -y curl ca-certificates
fi

# --- tarball resolution ----------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARBALL=""
SHA256_FILE=""

if compgen -G "$SCRIPT_DIR/smart-rfid-gate-*.tar.gz" >/dev/null; then
  TARBALL="$(ls -t "$SCRIPT_DIR"/smart-rfid-gate-*.tar.gz | head -1)"
elif compgen -G "$SCRIPT_DIR/../dist/smart-rfid-gate-*.tar.gz" >/dev/null; then
  TARBALL="$(ls -t "$SCRIPT_DIR"/../dist/smart-rfid-gate-*.tar.gz | head -1)"
elif [[ -n "$TARBALL_URL" && "$TARBALL_URL" != "$DEFAULT_URL" ]]; then
  TARBALL="$(mktemp /tmp/smart-rfid-gate-XXXXXX.tar.gz)"
  log "downloading $TARBALL_URL"
  curl -fL --retry 3 -o "$TARBALL" "$TARBALL_URL"
  if [[ -n "${TARBALL_URL%.sha256}" ]] && curl -fL --retry 3 -o "$TARBALL.sha256" "$TARBALL_URL.sha256" 2>/dev/null; then
    SHA256_FILE="$TARBALL.sha256"
  fi
elif [[ "$DEFAULT_URL" != "PASTE_SUPABASE_TARBALL_URL_HERE" ]]; then
  TARBALL="$(mktemp /tmp/smart-rfid-gate-XXXXXX.tar.gz)"
  log "downloading $DEFAULT_URL"
  curl -fL --retry 3 -o "$TARBALL" "$DEFAULT_URL"
  if curl -fL --retry 3 -o "$TARBALL.sha256" "$DEFAULT_URL.sha256" 2>/dev/null; then
    SHA256_FILE="$TARBALL.sha256"
  fi
else
  die "no tarball found: put one next to install.sh, in dist/, or pass --url"
fi

# --- checksum --------------------------------------------------------------
# Verify by piping "hash  file" into sha256sum -c - so the check works both
# for tarballs sitting next to the script and for downloads under /tmp whose
# temp name differs from the name recorded in the .sha256 file.
if [[ -z "$SHA256_FILE" && -f "$TARBALL.sha256" ]]; then
  SHA256_FILE="$TARBALL.sha256"
fi
if [[ -n "$SHA256_FILE" ]]; then
  log "verifying checksum"
  echo "$(awk '{print $1}' "$SHA256_FILE")  $TARBALL" | sha256sum -c - \
    || die "checksum mismatch for $TARBALL"
else
  log "WARNING: no .sha256 found next to tarball, skipping verification"
fi

# --- node 22 ----------------------------------------------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'parseInt(process.versions.node, 10)')"
  [[ "$major" -ge 22 ]] && need_node=0
fi
if [[ "$need_node" -eq 1 ]]; then
  log "installing Node 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi
NODE_BIN="$(command -v node)"
log "using node: $NODE_BIN ($($NODE_BIN -v))"

# --- stop old service -------------------------------------------------------
if [[ "$NO_SERVICE" -eq 0 ]] && systemctl list-unit-files | grep -q "^$SERVICE"; then
  log "stopping existing service"
  $SUDO systemctl stop "$SERVICE" 2>/dev/null || true
  $SUDO systemctl disable "$SERVICE" 2>/dev/null || true
fi

# --- migrate old DB (before the app-dir wipe destroys it) -------------------
if [[ -f "$APP_DIR/data/app.db" && ! -f "$DATA_DIR/app.db" ]]; then
  log "migrating old app.db into $DATA_DIR"
  $SUDO mkdir -p "$DATA_DIR"
  $SUDO chown -R "$INVOKING_USER" "$DATA_DIR"
  $SUDO mv "$APP_DIR/data/app.db" "$DATA_DIR/app.db"
fi

# --- swap app dir (temp extract + mv) ---------------------------------------
TMP_EXTRACT="$(mktemp -d /tmp/smart-rfid-gate-app-XXXXXX)"
tar -xzf "$TARBALL" -C "$TMP_EXTRACT"
$SUDO mkdir -p "$APP_DIR"
$SUDO find "$APP_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
$SUDO cp -a "$TMP_EXTRACT/." "$APP_DIR/"
$SUDO chown -R "$INVOKING_USER" "$APP_DIR"
rm -rf "$TMP_EXTRACT"

# --- data dir ----------------------------------------------------------------
$SUDO mkdir -p "$DATA_DIR"
$SUDO chown -R "$INVOKING_USER" "$DATA_DIR"

# --- cleanup temp tarball ----------------------------------------------------
case "$TARBALL" in /tmp/*) rm -f "$TARBALL" "$TARBALL.sha256" 2>/dev/null || true ;; esac

# --- systemd unit ------------------------------------------------------------
if [[ "$NO_SERVICE" -eq 0 ]]; then
  DOCKER_GROUP_LINE=""
  if getent group docker >/dev/null 2>&1; then
    DOCKER_GROUP_LINE="SupplementalGroups=docker"
  fi
  UNIT="/etc/systemd/system/$SERVICE.service"
  # Emit the SupplementalGroups line only when a docker group exists, so the
  # unit never carries a stray blank line where the directive would be.
  {
    cat <<EOF
[Unit]
Description=Smart RFID Gate control panel
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=$INVOKING_USER
EOF
    if [[ -n "$DOCKER_GROUP_LINE" ]]; then
      printf '%s\n' "$DOCKER_GROUP_LINE"
    fi
    cat <<EOF
WorkingDirectory=$APP_DIR
Environment="PORT=$PORT" "DB_PATH=$DATA_DIR/app.db" "HOME=$HOME"
ExecStart=$NODE_BIN $APP_DIR/build
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  } | $SUDO tee "$UNIT" >/dev/null
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now "$SERVICE"

  # --- health check ----------------------------------------------------------
  log "waiting for panel on port $PORT"
  ok=0
  for _ in $(seq 1 30); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT" || true)"
    if [[ "$code" =~ ^(200|301|302|307|308)$ ]]; then ok=1; break; fi
    sleep 1
  done
  if [[ "$ok" -ne 1 ]]; then
    echo "[install] error: panel did not come up. Check: journalctl -u $SERVICE -n 50" >&2
    exit 1
  fi

  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  log "panel running: http://${LAN_IP:-<box-ip>}:$PORT"
else
  log "--no-service: app extracted to $APP_DIR"
  log "run later with: DB_PATH=$DATA_DIR/app.db PORT=$PORT $NODE_BIN $APP_DIR/build"
fi

log "done"
