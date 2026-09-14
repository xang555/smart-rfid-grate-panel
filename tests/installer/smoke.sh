#!/usr/bin/env bash
# Container smoke test for scripts/install.sh. Requires Docker.
# Exercises: fresh install (--no-service), layout assertions, the systemd
# unit rendering (--print-unit), and the upgrade path (second run must
# preserve /var/lib/smart-rfid-gate/app.db).
set -euo pipefail

cd "$(dirname "$0")/../.."

if ! command -v docker >/dev/null 2>&1; then
  echo "smoke test needs docker" >&2
  exit 1
fi
if ! ls dist/smart-rfid-gate-*.tar.gz >/dev/null 2>&1; then
  echo "no tarball in dist/ - run scripts/package-release.sh first" >&2
  exit 1
fi

docker run --rm -v "$PWD":/repo -w /repo ubuntu:24.04 bash -ceu '
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl
  # fresh install (no systemd in container)
  bash scripts/install.sh --no-service
  test -f /opt/smart-rfid-gate/build/index.js
  test -f /opt/smart-rfid-gate/package.json
  test -d /var/lib/smart-rfid-gate
  # systemd unit rendering (--print-unit must work without root or systemd)
  local_unit="$(bash scripts/install.sh --print-unit)"
  echo "$local_unit" | grep -q 'User=root'
  echo "$local_unit" | grep -q 'Environment=.*DB_PATH=/var/lib/smart-rfid-gate/app.db'
  echo "$local_unit" | grep -q 'Environment=.*PORT=3000'
  echo "$local_unit" | grep -q 'ExecStart=.*node /opt/smart-rfid-gate/build'
  echo "$local_unit" | grep -q 'Restart=always'
  # plant a DB marker, then upgrade
  echo marker-1 > /var/lib/smart-rfid-gate/app.db
  bash scripts/install.sh --no-service
  grep -q marker-1 /var/lib/smart-rfid-gate/app.db
  echo "SMOKE OK"
'
