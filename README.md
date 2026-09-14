# Smart RFID Gate — Web Control Panel

A small SvelteKit app that runs on the gate box. It guards itself with a PIN,
installs the RFID gate project, edits the project's TOML config through typed
forms, and starts or stops the three gate services — each one on its own, or all
of them together.

## Services

| # | Service   | What it is                          | How it is started        |
|---|-----------|-------------------------------------|--------------------------|
| 1 | Reader    | `impinJReaderGateway/ImpinJReader`  | spawned as a process     |
| 2 | IP Camera | `ipcame`                            | `docker compose up -d`   |
| 3 | Gate RFID | `rfid`                              | `docker compose up -d`   |

Start order is 1 → 2 → 3. Stop runs in reverse. Gate RFID needs Reader and IP
Camera up first; starting it alone opens a confirmation dialog.

## Configuration

Settings edits write to the project's TOML files:

| Tab       | File                      |
|-----------|---------------------------|
| Reader    | `config.toml`             |
| Cameras   | `ipcame/config.toml`      |
| Gate RFID | `rfid/config/config.toml` |

Writes are atomic and leave a `.bak` of the previous file. Unknown keys are
preserved; hand-written comments outside known keys are not.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
```

First run sends you to `/setup-pin` to create a 6–12 digit PIN.

## Test

```bash
npm test             # vitest unit + integration
npx playwright install chromium
npm run test:e2e     # playwright
```

The e2e suite is serial: it creates a panel PIN (`135790`) in the dev database
and points `project_path` at a disposable copy of `tests/fixtures/fake-project`.
Delete `data/app.db` before a run to exercise the first-boot path.

## Build and run

```bash
npm run build
node build                 # defaults to port 3000
DB_PATH=./data/app.db PORT=3000 node build
```

The database lives at `DB_PATH` (default `./data/app.db`) and holds the PIN
hash, sessions, app config, and the last known service state.

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
