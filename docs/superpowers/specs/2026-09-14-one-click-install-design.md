# One-Click Install for Ubuntu — Design

Date: 2026-09-14
Status: Approved in chat, 2026-09-14

## Problem

The panel runs on the gate box (Ubuntu) via manual steps: install Node, build,
`node build`. The operator wants one command that installs and runs the panel
on a fresh Ubuntu machine, survives reboot, and upgrades in place without
losing data. macOS gets no installer — dev/preview docs only.

## Decisions (from chat)

- **Target:** Ubuntu only. macOS documented as `npm run dev` preview.
- **Shape:** `install.sh` + systemd service. `curl | bash` or local run.
- **Artifact host:** Supabase storage (same flow as the existing
  `asian-pj.zip` download in `scripts/setup.sh`).
- **Arch:** linux x64. Gate box assumed x64; ARM packaging left as future flag.

## Components

### 1. `scripts/package-release.sh` — build machine

Produces the release tarball.

- Runs inside a `node:22-bookworm-slim` Docker container when Docker is
  available, so packaging works from any host OS (macOS included). Needed
  because `better-sqlite3` compiles a platform-specific binding; the tarball
  must carry the Linux x64 build.
  Sequence: `npm ci` (full, for the build), `npm run build`, then
  `npm ci --omit=dev` to replace `node_modules` with production-only deps.
- No Docker? Falls back to a native build, allowed only on Linux x64 hosts
  (e.g. the gate box itself). Any other host aborts with a clear message.
- Tars `build/`, production `node_modules/` (via `npm ci --omit=dev` for
  runtime deps) and `package.json` into
  `smart-rfid-gate-<version>-linux-x64.tar.gz`.
- Emits `<tarball>.sha256` (sha256sum) for install-time verification.
- Output lands in `dist/` (git-ignored).

### 2. `scripts/install.sh` — gate box

One command installs, enables, and starts the panel.

Order of operations:

1. `set -euo pipefail`; require bash; install `curl` via apt if missing;
   systemd required unless `--no-service`.
2. Tarball source resolution, first match wins:
   - file named `smart-rfid-gate-*.tar.gz` next to the script, then in
     `dist/` (offline/USB/local build)
   - `--url <url>` argument
   - baked-in default Supabase URL constant at the top of the script
3. Download (if remote), verify sha256 against `<tarball>.sha256` fetched from
   the same location. Mismatch aborts.
4. Install Node 22 via NodeSource apt repo if `node` is missing or < 22.
5. Stop + disable existing `smart-rfid-gate.service` if present (upgrade path).
6. Extract tarball to a temp dir, then swap into `/opt/smart-rfid-gate`
   (old contents removed, new moved in) so a failed extraction never leaves a
   half-installed app.
7. Ensure `/var/lib/smart-rfid-gate` exists, owned by the invoking user; this
   holds `app.db` so data survives upgrades. On first install, if
   `/opt/smart-rfid-gate/data/app.db` exists from an old layout, move it to
   `/var/lib/smart-rfid-gate/`.
8. Write `/etc/systemd/system/smart-rfid-gate.service` via heredoc:
   - `User=` and `SupplementalGroups=docker` set to the invoking (sudo) user,
     so the panel can spawn `docker compose`
   - `Environment=PORT=3000 DB_PATH=/var/lib/smart-rfid-gate/app.db`
   - `ExecStart=/usr/bin/node /opt/smart-rfid-gate/build`
   - `Restart=always`, `WantedBy=multi-user.target`
9. `daemon-reload`, `enable --now`, health-check: poll `http://127.0.0.1:3000`
   until HTTP 200/3xx (timeout ~30s), then print the LAN URL
   `http://<box-ip>:3000`.

Flags: `--url <u>`, `--port <p>` (default 3000), `--no-service` (extract +
instructions only; used by automated tests in containers without systemd).

### 3. README section

- Build a release: `bash scripts/package-release.sh`, upload both files from
  `dist/` to Supabase, paste URL into `install.sh` constant.
- Install on gate box: the one-liner.
- macOS note: `npm install && npm run dev` for preview; no installer, no
  reader hardware.

## Env var support (existing, verified)

- `src/lib/server/db.ts:61` reads `DB_PATH` (default `./data/app.db`).
- Adapter-node `build/index.js` reads `PORT`/`HOST`/`ORIGIN`.
No app code changes required.

## Error handling

- Both scripts: `set -euo pipefail`, explicit messages on each failure.
- Checksum mismatch → abort before touching disk.
- Node absent/old → install via NodeSource; apt failures surface verbatim.
- Upgrade: service stopped first; extraction is atomic-enough via extract to
  temp dir + `mv` swap; DB lives outside install dir so it is never touched.
- Health check failure → `journalctl -u smart-rfid-gate` hint printed, exit 1.

## Testing

- `shellcheck scripts/install.sh scripts/package-release.sh`.
- Fresh Ubuntu 24.04 container: run `install.sh --no-service` with a local
  tarball; assert extracted layout + env file contents. Node install path
  exercised on a container without Node.
- Upgrade test: install, create DB marker (start app once), re-install,
  assert DB file unchanged.
- Manual gate-box run by operator.

## Out of scope

- ARM builds, auto-update, .deb packaging, CI pipeline, macOS installer,
  HTTPS/reverse proxy setup.
