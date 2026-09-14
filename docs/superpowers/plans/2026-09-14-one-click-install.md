# One-Click Ubuntu Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command on a fresh Ubuntu box installs the panel, starts it as a systemd service, survives reboot, and upgrades in place without losing the database.

**Architecture:** A release script builds a Linux x64 tarball (app build + production `node_modules`, built in Docker when available). An installer script on the gate box resolves the tarball (local file, `--url`, or baked-in Supabase URL), verifies its checksum, installs Node 22 if needed, swaps the app into `/opt/smart-rfid-gate`, keeps the DB in `/var/lib/smart-rfid-gate`, and manages a systemd unit.

**Tech Stack:** Bash, systemd, NodeSource apt repo, Docker (build-time only), tar + sha256sum.

**Spec:** `docs/superpowers/specs/2026-09-14-one-click-install-design.md`

## Global Constraints

- Target: Ubuntu (apt-based) on linux x64. No macOS installer.
- `better-sqlite3` binding in the tarball must be linux x64.
- DB lives at `/var/lib/smart-rfid-gate/app.db` (env `DB_PATH`), never inside the install dir.
- Install dir: `/opt/smart-rfid-gate`. Service name: `smart-rfid-gate`. Default port: `3000`.
- Both scripts: `set -euo pipefail`, bash.
- Existing env support (verified): `src/lib/server/db.ts:61` reads `DB_PATH`; adapter-node reads `PORT`. No app code changes.
- Version source: `package.json` `version` field (currently `0.0.1`).
- Tarball name pattern (exact): `smart-rfid-gate-<version>-linux-x64.tar.gz`, checksum file is the same name + `.sha256`.

---

### Task 1: Release packaging script

**Files:**
- Create: `scripts/package-release.sh`
- Modify: `.gitignore` (add `/dist`)

**Interfaces:**
- Consumes: `package.json` (`version`), npm scripts `build`.
- Produces: `dist/smart-rfid-gate-<version>-linux-x64.tar.gz` + `.sha256`. Task 2's installer and Task 3's smoke test consume this exact name pattern.

- [ ] **Step 1: Write `scripts/package-release.sh`**

```bash
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
```

- [ ] **Step 2: Add `/dist` to `.gitignore`**

Append to the "# App runtime data" group in `.gitignore`:

```
# Release artifacts
/dist
```

- [ ] **Step 3: Lint**

Run: `shellcheck scripts/package-release.sh` (install via `brew install shellcheck` if missing)
Expected: no findings. If shellcheck is unavailable on this machine, note it and rely on `bash -n scripts/package-release.sh` (syntax check) passing.

- [ ] **Step 4: Verify build works (only where possible)**

On a machine with Docker or on the gate box: run `bash scripts/package-release.sh`, then:

```bash
tar -tzf dist/smart-rfid-gate-*-linux-x64.tar.gz | grep -E "build/index.js|node_modules/better-sqlite3/build/Release/better_sqlite3.node|package.json" | head
cat dist/smart-rfid-gate-*-linux-x64.tar.gz.sha256
```

Expected: all three paths listed; checksum file contains one line. On a Mac without Docker, skip this step and leave a note in the task report — Task 3 runs the verification inside a container.

- [ ] **Step 5: Commit**

```bash
git add scripts/package-release.sh .gitignore
git commit -m "feat: release packaging script for linux x64 tarball"
```

---

### Task 2: Gate-box installer script

**Files:**
- Create: `scripts/install.sh`

**Interfaces:**
- Consumes: tarball + `.sha256` from Task 1 (name pattern `smart-rfid-gate-*.tar.gz`).
- Produces: running `smart-rfid-gate.service`; app at `/opt/smart-rfid-gate`; DB dir `/var/lib/smart-rfid-gate`. Flags parsed: `--url <u>`, `--port <p>`, `--no-service`. Task 3's smoke test drives `--no-service` and asserts the on-disk layout.

- [ ] **Step 1: Write `scripts/install.sh`**

```bash
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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url) TARBALL_URL="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --no-service) NO_SERVICE=1; shift ;;
    --help|-h)
      grep '^# ' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ $EUID -eq 0 ]]; then
  SUDO=""
  INVOKING_USER="${SUDO_USER:-root}"
else
  SUDO="sudo"
  INVOKING_USER="$(id -un)"
fi

log() { echo "[install] $*"; }
die() { echo "[install] error: $*" >&2; exit 1; }

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

# --- swap app dir (temp extract + mv) ---------------------------------------
TMP_EXTRACT="$(mktemp -d /tmp/smart-rfid-gate-app-XXXXXX)"
tar -xzf "$TARBALL" -C "$TMP_EXTRACT"
$SUDO mkdir -p "$APP_DIR"
$SUDO find "$APP_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
$SUDO cp -a "$TMP_EXTRACT/." "$APP_DIR/"
$SUDO chown -R "$INVOKING_USER" "$APP_DIR"
rm -rf "$TMP_EXTRACT"

# --- data dir + migrate old DB ----------------------------------------------
$SUDO mkdir -p "$DATA_DIR"
$SUDO chown -R "$INVOKING_USER" "$DATA_DIR"
if [[ -f "$APP_DIR/data/app.db" && ! -f "$DATA_DIR/app.db" ]]; then
  log "migrating old app.db into $DATA_DIR"
  mv "$APP_DIR/data/app.db" "$DATA_DIR/app.db"
fi

# --- cleanup temp tarball ----------------------------------------------------
case "$TARBALL" in /tmp/*) rm -f "$TARBALL" "$TARBALL.sha256" 2>/dev/null || true ;; esac

# --- systemd unit ------------------------------------------------------------
if [[ "$NO_SERVICE" -eq 0 ]]; then
  DOCKER_GROUP_LINE=""
  if getent group docker >/dev/null 2>&1; then
    DOCKER_GROUP_LINE="SupplementalGroups=docker"
  fi
  UNIT="/etc/systemd/system/$SERVICE.service"
  $SUDO tee "$UNIT" >/dev/null <<EOF
[Unit]
Description=Smart RFID Gate control panel
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=$INVOKING_USER
$DOCKER_GROUP_LINE
WorkingDirectory=$APP_DIR
Environment="PORT=$PORT" "DB_PATH=$DATA_DIR/app.db" "HOME=$HOME"
ExecStart=$NODE_BIN $APP_DIR/build
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
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
```

Notes for the implementer:
- `bash -ceu` inside Task 1's container is `set -e -u` plus pipefail? No — it is only `-e -u`. Task 1's heredoc does not need pipefail; leave as is.
- `SupplementalGroups` may render as an empty line when no docker group exists; systemd tolerates empty lines in unit files, but if shellcheck/`systemd-analyze verify` complains, guard the heredoc by conditionally appending the line instead.
- `HOME=$HOME` in the unit uses the *installer's* HOME; the panel spawns `docker compose` and needs a writable HOME. If the invoking user is root via `curl | bash`, note in the final report that operators should run the script as their normal user with sudo.

- [ ] **Step 2: Lint**

Run: `shellcheck scripts/install.sh && bash -n scripts/install.sh`
Expected: no findings.

- [ ] **Step 3: Verify flag parsing offline**

Run: `bash scripts/install.sh --help`
Expected: prints usage header lines, exits 0.

Run: `bash scripts/install.sh --bogus`
Expected: `[install] error: unknown arg: --bogus`, exit 1. (Safe: prerequisites check runs after arg parsing? No — arg parsing is first, so it exits before touching apt.)

- [ ] **Step 4: Commit**

```bash
git add scripts/install.sh
git commit -m "feat: one-command Ubuntu installer with systemd service"
```

---

### Task 3: Container smoke test for the installer

**Files:**
- Create: `tests/installer/smoke.sh`

**Interfaces:**
- Consumes: `scripts/install.sh` (Task 2), `dist/smart-rfid-gate-*.tar.gz` (Task 1 output).
- Produces: exit 0 with `SMOKE OK` when fresh install + upgrade-preserves-DB both pass.

- [ ] **Step 1: Write `tests/installer/smoke.sh`**

```bash
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
```

- [ ] **Step 2: Lint**

Run: `shellcheck tests/installer/smoke.sh`
Expected: no findings.

- [ ] **Step 3: Run (only where Docker exists)**

Run: `bash tests/installer/smoke.sh`
Expected: ends with `SMOKE OK`. Takes several minutes (NodeSource install inside the container). On a machine without Docker, skip with a note — the gate box runs it.

- [ ] **Step 4: Commit**

```bash
git add tests/installer/smoke.sh
git commit -m "test: container smoke test for Ubuntu installer"
```

---

### Task 4: README section

**Files:**
- Modify: `README.md` (append a "Install on the gate box (Ubuntu)" section after "Build and run")

**Interfaces:**
- Consumes: script names and flag surface from Tasks 1–2.
- Produces: operator-facing docs only.

- [ ] **Step 1: Append README section**

```markdown
## Install on the gate box (Ubuntu)

One command on a fresh Ubuntu box installs the panel and starts it as a
systemd service (`smart-rfid-gate`), restarted on boot:

```bash
bash scripts/install.sh
```

The installer picks up a tarball from `dist/` if present, else downloads the
URL baked into `scripts/install.sh` (`DEFAULT_URL`). Flags: `--url`, `--port`
(default 3000), `--no-service`. The database lives at
`/var/lib/smart-rfid-gate/app.db`, so re-running the installer upgrades the
app and keeps your data.

### Build a release

```bash
bash scripts/package-release.sh     # needs Docker, or a linux x64 machine
# upload dist/smart-rfid-gate-<version>-linux-x64.tar.gz{,.sha256}
# paste the tarball URL into DEFAULT_URL in scripts/install.sh
```

### Service control

```bash
systemctl status smart-rfid-gate
journalctl -u smart-rfid-gate -f
```

### macOS

No installer. For preview only: `npm install && npm run dev`
(reader hardware and the gate services need the Ubuntu box).
```

- [ ] **Step 2: Verify rendering**

Run: `grep -c "smart-rfid-gate" README.md`
Expected: count increased; section appears after "Build and run".

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: gate box install and release build instructions"
```
