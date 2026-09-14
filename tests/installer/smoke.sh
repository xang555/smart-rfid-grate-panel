#!/usr/bin/env bash
# Container smoke test for scripts/install.sh. Requires Docker.
# Exercises: fresh install (--no-service), layout assertions, and the
# upgrade path (second run must preserve /var/lib/smart-rfid-gate/app.db).
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
  # plant a DB marker, then upgrade
  echo marker-1 > /var/lib/smart-rfid-gate/app.db
  bash scripts/install.sh --no-service
  grep -q marker-1 /var/lib/smart-rfid-gate/app.db
  echo "SMOKE OK"
'
