#!/usr/bin/env bash
# Build the distributable release tarball for the gate box (linux x64).
# Output: dist/smart-rfid-gate-<version>-linux-x64.tar.gz (+ .sha256).
#
# The tarball must carry a linux-x64 better-sqlite3 binding, so the build
# runs in a node:22-bookworm-slim container when Docker is available.
# Without Docker, a native build is allowed only on linux x64.
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION="$(node -p "require('./package.json').version")"
OUT="dist"
NAME="smart-rfid-gate-${VERSION}-linux-x64"

build_native() {
  npm ci
  npm run build
  npm ci --omit=dev
  mkdir -p "$OUT"
  tar -czf "$OUT/$NAME.tar.gz" build node_modules package.json
  (cd "$OUT" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
}

if command -v docker >/dev/null 2>&1; then
  mkdir -p "$OUT"
  # --user keeps the artifacts owned by the invoking user, not root.
  docker run --rm --user "$(id -u):$(id -g)" -e NAME="$NAME" \
    -v "$PWD":/app -v "$PWD/$OUT":/out \
    -w /app node:22-bookworm-slim bash -ceu '
      export HOME=/tmp
      npm ci
      npm run build
      npm ci --omit=dev
      mkdir -p /out
      tar -czf "/out/$NAME.tar.gz" build node_modules package.json
      cd /out
      sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256"
    '
elif [[ "$(uname -s)-$(uname -m)" == "Linux-x86_64" ]]; then
  build_native
else
  echo "error: release builds need Docker (any host) or a native linux x64 machine." >&2
  exit 1
fi

echo "Built $OUT/$NAME.tar.gz (+ .sha256)"
