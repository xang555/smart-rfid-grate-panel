#!/usr/bin/env bash
# Uninstall the Smart RFID Gate panel from an Ubuntu box.
#
# Usage: bash uninstall.sh [--purge-data]
#
# Stops and removes the systemd service and the app directory. The database
# at /var/lib/smart-rfid-gate is KEPT by default so a later reinstall keeps
# your PIN and settings; pass --purge-data to delete it permanently.
set -euo pipefail

SERVICE="smart-rfid-gate"
APP_DIR="/opt/smart-rfid-gate"
DATA_DIR="/var/lib/smart-rfid-gate"

PURGE_DATA=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-data) PURGE_DATA=1; shift ;;
    --help|-h)
      grep '^# ' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ $EUID -eq 0 ]]; then
  SUDO=""
else
  SUDO="sudo"
fi

log() { echo "[uninstall] $*"; }

# --- service -----------------------------------------------------------------
if systemctl list-unit-files 2>/dev/null | grep "^$SERVICE" >/dev/null; then
  log "stopping and removing $SERVICE.service"
  $SUDO systemctl disable --now "$SERVICE" 2>/dev/null || true
  $SUDO rm -f "/etc/systemd/system/$SERVICE.service"
  $SUDO systemctl daemon-reload
  $SUDO systemctl reset-failed 2>/dev/null || true
else
  log "no $SERVICE.service found"
fi

# --- app dir -----------------------------------------------------------------
# No -q in the grep pipelines (SIGPIPE + pipefail false negative, see install.sh).
for dir in "$APP_DIR" "${APP_DIR}.old" "${APP_DIR}.new"; do
  if [[ -d "$dir" ]]; then
    $SUDO rm -rf "$dir"
    log "removed $dir"
  fi
done

# --- data dir ----------------------------------------------------------------
if [[ "$PURGE_DATA" -eq 1 ]]; then
  if [[ -d "$DATA_DIR" ]]; then
    # Destructive: removes app.db (PIN, settings, service state). No undo.
    $SUDO rm -rf "$DATA_DIR"
    log "purged $DATA_DIR"
  else
    log "no data dir at $DATA_DIR"
  fi
else
  if [[ -d "$DATA_DIR" ]]; then
    log "kept database at $DATA_DIR (reinstall keeps your PIN)"
    log "delete permanently with: sudo rm -rf $DATA_DIR  or rerun with --purge-data"
  fi
fi

log "note: docker group membership and the Node.js package were left untouched"
log "done"
