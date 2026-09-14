# Smart RFID Gate Webapp — Design

Date: 2026-09-14
Status: Approved (pending user spec review)

## 1. Purpose

A production-grade web control panel for a smart RFID gate appliance. It lets an
operator, from a browser on the gate box (or LAN), do four things:

1. Unlock the panel with a PIN (created on first run).
2. Install the gate project on a fresh machine by running `setup.sh`.
3. Edit the gate's configuration (the `.toml` files) through typed forms.
4. Start and stop the three gate services in order, watching live logs and
   per-service state.

The webapp is the operator surface for hardware that already exists in
`docs/simple/`: a native `ImpinJReader` binary, and two Docker Compose stacks
(`ipcame`, `rfid`). The webapp does not reimplement them; it orchestrates and
configures them.

## 2. Context (existing artifacts)

- `docs/simple/setup.sh` — bash installer. Args `-u <docker_user> -p <docker_pass>`.
  Installs Docker/curl/Syncthing, downloads `asian-pj.zip` from Supabase storage,
  extracts to `~/Desktop/asean-project`, copies `syncthing.service`, docker-logs-in
  to `registry.gitlab.com`, runs `xhost +local:docker`. Requires sudo. Targets Ubuntu.
- `docs/simple/asian-pj/` — the installed project layout:
  - `config.toml` — ImpinJ reader config (reader name, speedway address, socket
    port, session, rf_mode, search mode, `[filter]`, `[[antennas]]` array).
  - `impinJReaderGateway/ImpinJReader` — native ELF x86-64 .NET 8 self-contained
    binary + its DLLs. Launched as `./impinJReaderGateway/ImpinJReader config.toml`.
  - `ipcame/` — `config.toml` (SERVICE_PORT, image size, rotate, `[[ipcame]]`
    array of cameras) + `docker-compose.yml` (image `.../23-s-asian-ipcame-service`,
    host network, X11 socket, port 5555).
  - `rfid/` — `config/config.toml` (socket addr/port, MQTT, search mode,
    `[[gates]]` array) + `docker-compose.yml` (image
    `.../23-s-asian-rfid-gate-service`, host network, mounts `./config`).
  - `start.sh` / `stop.sh` — reference scripts: ipcame `compose up -d` then rfid
    `compose up -d`; stop does `compose down` for each.

The user-specified start order is: **reader → ipcame → rfid**. Stop is the reverse.

## 3. Decisions (locked)

| Topic | Decision |
|---|---|
| Project path | Configurable, stored in DB, default `~/Desktop/asean-project`. Editable in UI. |
| Process model | Node spawns the reader as a detached child (PID tracked); uses `docker compose up -d` / `down` for ipcame and rfid. |
| Control granularity | Each service starts/stops individually **and** via START ALL / STOP ALL. |
| Settings UI | Full typed form for every field in all three `.toml` files, human-readable labels. |
| Docker images | Image ref + pull policy per docker service, stored in `app_config`, editable in `/settings`; applied through a panel-owned compose override file; pulled on start (§8.6). |
| Auth | Single PIN, scrypt hash + per-PIN salt, server-side sessions, rate-limited. |
| Styling | SvelteKit + Tailwind v4 + shadcn-svelte; "Soft Dark" theme (see §10). |
| Main layout | L2 split — controls left, live log docked right, full height. |
| Scope | Full scope in one pass. |

## 4. Stack

- **SvelteKit** with **adapter-node**, SSR enabled. Single Node process.
- **better-sqlite3** — synchronous, WAL mode, foreign keys on.
- **smol-toml** — parse and stringify TOML.
- **yaml** — parse the compose files to detect the service to override (§8.6).
  TOML and YAML both appear because the panel edits TOML config but *reads*
  compose YAML.
- **Tailwind CSS v4** + **shadcn-svelte** components.
- **Zod** — validation of config form values and API payloads.
- **Vitest** — unit tests. **Playwright** — e2e tests.
- Runtime: Node 20+, Linux (gate box). Dev on macOS is fine; service control
  paths are Linux/docker-specific and are integration-tested via mocks.

## 5. Architecture

### 5.1 Layout

```
src/
  app.html, app.css, hooks.server.ts
  lib/
    server/
      db.ts               open + migrate
      auth.ts             PIN hash/verify, sessions, rate-limit
      settings.ts         app_config get/set, project path resolution
      config/
        schema.ts         typed field definitions for the 3 toml files
        store.ts          read/write toml through schema, comment-preserving
      proc/
        reader.ts         spawn/stop/watch ImpinJReader
        docker.ts         wrap docker compose up/down/ps/pull
        compose.ts        override file: detect service, render, write, args
      services/
        manager.ts        state machine, orchestration, event bus, log ring
        types.ts
      setup.ts            run setup.sh, stream output, detect installed
      log.ts              structured server logger
    components/
      ui/                 shadcn-svelte components
      StatusCard.svelte, LogConsole.svelte, PinInput.svelte, FieldRenderer.svelte, ...
    types.ts              shared types
  routes/
    +layout.server.ts     session guard helper
    setup-pin/            first-run PIN creation
    login/                PIN entry
    +page.svelte          main control screen
    setup/                installer screen
    settings/             config editor
    api/
      auth/{setup-pin,login,logout}
      status                GET aggregate state
      logs                  GET SSE stream
      services/[name]/start POST  (body {force?})
      services/[name]/stop  POST
      services/start-all    POST
      services/stop-all     POST
      setup/run             POST (SSE progress)
      config/[file]         GET/PUT
      images                GET   all docker image settings + status
      images/[name]         PATCH image ref + pull policy
      images/[name]/pull    POST  (SSE progress)
```

### 5.2 Module boundaries

Each server module has one purpose and a narrow interface:

- `db.ts` → `db()` returns the singleton better-sqlite3 handle; runs migrations.
- `auth.ts` → `hasPin()`, `createPin(pin)`, `verifyPin(pin, ip)`,
  `createSession()`, `validateSession(id)`, `destroySession(id)`,
  `cleanupExpired()`.
- `config/schema.ts` → `SCHEMAS: Record<ConfigFile, Section[]>`; pure data.
- `config/store.ts` → `readConfig(file, base)`, `writeConfig(file, base, values)`;
  depends only on smol-toml + schema.
- `proc/reader.ts` → `start(ctx)`, `stop()`, `probe(ctx)`, `current()`.
- `proc/docker.ts` → `up(dir, file, extraArgs?)`, `down(dir, file, extraArgs?)`,
  `ps(dir, file, extraArgs?)`, `pull(dir, file, service, extraArgs?)`,
  `hasLocalImage(ref)`.
- `proc/compose.ts` → `detectComposeService(file)`, `renderOverride(service,
  image)`, `writeOverride(projectPath, service, image)`, `composeArgs(base,
  override?)`, `overridePath(projectPath, service)`; depends only on yaml + fs.
- `services/manager.ts` → `startOne(svc, {force})`, `stopOne(svc)`,
  `startAll()`, `stopAll()`, `status()`, `subscribe(fn)`, `reconcile()`;
  composes reader + docker + compose + db + log.
- `images.ts` → `imageConfig(svc)`, `setImageConfig(svc, patch)`,
  `resolveImage(svc, baseImage)`, `validateImageRef(ref)`, `pull(svc, onLog)`;
  owns §8.6, depends on settings + compose + docker.
- `setup.ts` → `installed(base)`, `run(creds, onLog)`.

`manager.ts` is the only module that knows the ordering and the state machine.
SvelteKit route handlers are thin adapters over these modules.

## 6. Data model

```sql
CREATE TABLE app_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
); -- project_path, pin_created_at, setup_completed_at, setup_docker_user,
   -- docker_image_ipcame, docker_image_rfid, docker_pull_ipcame, docker_pull_rfid, ...

CREATE TABLE pin (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  hash       BLOB NOT NULL,
  salt       BLOB NOT NULL,
  params     TEXT NOT NULL,   -- scrypt params JSON, for future migration
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

CREATE TABLE login_attempts (
  id           INTEGER PRIMARY KEY,
  ip           TEXT NOT NULL,
  attempted_at INTEGER NOT NULL,
  success      INTEGER NOT NULL
);
CREATE INDEX idx_attempts_ip_time ON login_attempts(ip, attempted_at);

CREATE TABLE service_state (
  name       TEXT PRIMARY KEY,     -- reader | ipcame | rfid
  desired    TEXT NOT NULL,        -- running | stopped
  actual     TEXT NOT NULL,        -- stopped|pulling|starting|running|stopping|error
  pid        INTEGER,
  detail     TEXT,                 -- last error message or note
  updated_at INTEGER NOT NULL
);

CREATE TABLE service_events (
  id      INTEGER PRIMARY KEY,
  service TEXT NOT NULL,
  level   TEXT NOT NULL,           -- info | success | warn | error
  message TEXT NOT NULL,
  detail  TEXT,                    -- raw stderr tail / exit code
  at      INTEGER NOT NULL
);
```

Migrations are numbered and run on boot, tracked in a `schema_version` table.
`service_events` is capped (delete oldest beyond 5,000 rows) on write.

## 7. Auth & security

- **First run.** If no `pin` row exists, every route redirects to `/setup-pin`.
  That route refuses to render once a PIN exists (404). PIN is 6–12 digits,
  confirmed by a second field.
- **Hashing.** `crypto.scryptSync(pin, salt, 64, { N: 16384, r: 8, p: 1 })`,
  16-byte random salt per PIN, cost params stored in `params`. Verify with
  `crypto.timingSafeEqual`.
- **Sessions.** `crypto.randomBytes(32).toString('base64url')` id, stored
  server-side, cookie `sid` with `HttpOnly`, `SameSite=Strict`, `Path=/`,
  `Secure` when the request is https. TTL 12h, sliding (refresh `expires_at`
  on activity, throttled to once per minute). Session cookie for the app;
  API mutating routes require a valid session and a matching `Origin`.
- **Rate limit.** ≥5 failed attempts from an IP within 15 minutes → block that
  IP for 15 minutes (429 with minutes remaining). Success clears the counter.
  All attempts logged.
- **CSRF.** `SameSite=Strict` plus explicit `Origin`/`Host` comparison on every
  POST/PUT.
- **Path safety.** `project_path` resolved and validated (must exist, must
  contain the expected layout when a service action requires it). Config writes
  are confined under `project_path`; the file key is an enum, never a
  user-supplied path.
- **Secret handling.** Docker password from the setup form is used for
  `docker login` via stdin only; it is never stored. Server logs redact it.
- **PIN reset.** CLI only: `npm run reset-pin` deletes the `pin` row and all
  sessions, forcing first-run flow again. No web reset path.

## 8. Service lifecycle

### 8.1 State machine

Per service:

```
stopped ──start──▶ [pulling] ──▶ starting ──ready──▶ running
   ▲                  │              │                  │
   │                  └──fail────────┴──fail──▶ error ──┘
   │                                                   │
   └──────────stop──────────────────────────────────────┘
              (running → stopping → stopped)
```

`pulling` applies only to the two docker services. A `docker compose pull`
downloads layers and can take minutes on a cold cache, so it needs its own
visible state — a row parked on `starting` for a minute reads as a hang. For
`reader`, which has no image, the transition is `stopped → starting` directly.

`pulling` is transitional: the aggregate banner groups it with
`starting`/`stopping` as degraded-but-moving, and `reconcile` treats it as
in-flight rather than as orphaned work.

Aggregate state = fold of the three. `error` in any service sets the overall
banner to error with the offending service named. `desired` (user intent) and
`actual` (observed) are stored separately so a crash is distinguishable from a
stop.

### 8.2 Start

There are two entry points, both routed through the same per-service primitive.

**Per-service primitive `startOne(service)`** is idempotent and returns a
structured result:

1. **reader** — validate `project_path/config.toml` and the binary exist;
   `spawn('./impinJReaderGateway/ImpinJReader', ['config.toml'], { cwd: project_path, detached: true, stdio: ['ignore','pipe','pipe'] })`.
   Record PID. Stream stdout/stderr into the log ring. Readiness = process alive
   after a 1s grace AND TCP connect to `speedway_address`'s `socket_port`
   (default 11000) succeeds within 10s. On failure → `error` with stderr tail.
2. **ipcame** — resolve image, write the override, pull, then
   `docker compose -f <project>/ipcame/docker-compose.yml [-f <override>] up -d`.
   Readiness = `docker compose ps` reports the service running (poll up to 30s).
3. **rfid** — the same sequence against `rfid/docker-compose.yml`.

For the two docker services the start sequence is:

1. **Resolve the image.** A configured `docker_image_<service>` wins; otherwise
   the compose file's own `image:` is used unchanged.
2. **Write the override** — only when an image is configured (see §8.6).
3. **Pull**, unless the policy is `never`. The service state is `pulling` for
   this step.
4. **On pull failure**, check for a local image. If one exists, log a `warn`
   naming the pull error and continue: a registry outage or an expired
   credential must not take down a gate that can already run. If no local image
   exists, the start fails with `error`.
5. **`up -d`**, then the readiness probe.

Each step emits `service_events` rows (info on attempt, success on ready, error
with `detail` on failure) and pushes them to SSE subscribers.

**Dependency guard.** `rfid` depends on `reader` (`localhost:11000`) and
`ipcame` (`:5555`); `ipcame` has no hard dependency. When the user starts a
service whose dependency is not `running`, the API returns
`{ ok:false, code:'dependency_down', missing:[...] }` unless the request sets
`force:true`. The UI shows a confirmation dialog naming the missing
dependencies and re-sends with `force:true` on confirm. START ALL never needs
force — it starts in dependency order.

**`startAll()`** runs `startOne` in order **reader → ipcame → rfid**, aborting on
the first failure and reporting which service failed and why. It is idempotent:
already-running services are skipped.

### 8.3 Stop

**Per-service primitive `stopOne(service)`** is best-effort per service and
returns a structured result:

- **rfid / ipcame** — `docker compose -f <dir>/docker-compose.yml down`.
- **reader** — `SIGTERM` to PID, wait up to 10s, then `SIGKILL`. Clear PID.

**`stopAll()`** runs `stopOne` in reverse order **rfid → ipcame → reader**,
best-effort (continues even if one step fails, collecting errors and reporting
all of them).

### 8.4 Reconciliation

On webapp boot, `reconcile()` reads `service_state`. For each service whose
`desired = running`: if the reader PID is still alive → adopt (mark `running`);
otherwise mark `stopped` with a `warn` event ("state lost after restart"). For
docker services, re-probe `compose ps` and adopt the observed state. A service
found in a transitional state (`pulling`, `starting`, `stopping`) is treated as
in-flight, not orphaned — its `desired` decides the outcome, so a webapp restart
mid-pull does not leave a service stuck. This prevents the webapp restarting
from silently orphaning the reader.

### 8.5 Logs

In-memory ring buffer (last 1,000 lines) plus persisted `service_events`. SSE
endpoint `/api/logs` replays the buffer then streams new events. Client shows
level colors, timestamps, service tag, and an expandable `detail` for failures.

### 8.6 Docker images

The two docker services run images the user controls, so the panel can point
them at a different image and pull it on start. The reader is a spawned binary
with no image and is unaffected.

**Where the image lives.** The image is a compose concern, not TOML config, so
it is stored in `app_config` — not in a schema-driven TOML file:

| key | default | meaning |
|---|---|---|
| `docker_image_ipcame` | `''` | image ref for ipcame; empty = use the compose file's own |
| `docker_image_rfid` | `''` | same for rfid |
| `docker_pull_ipcame` | `always` | `always` \| `never` |
| `docker_pull_rfid` | `always` | same |

**Applying the image.** `docker compose` has no CLI flag to override an image,
and the shipped compose files do not use `${IMAGE}` substitution. So the panel
writes a **compose override file** and starts with
`-f <base> -f <override>`:

- Path: `<project>/.rfid-panel/compose-<service>.yml`, written atomically
  (temp + rename), inside the `project_path` boundary of §7.
- Content: a single `services:` key holding one service with one `image:` field.
  Fully regenerated from `app_config` on every start, never merged with
  anything — so settings are the only source of truth and the file is
  disposable.
- The shipped compose files are **never** read-modified-written. They stay
  byte-identical.
- When no image is configured, no override is written and no `-f` is added.
- **Argument order matters.** The base file must come first: with multiple `-f`
  flags compose derives the project name from the first file's directory and
  resolves relative paths against it. The base files use relative volume mounts
  (`./config.toml`, `./config`), so reversing the order would break them. The
  override itself declares no paths — only `image:` — so it is order-agnostic on
  its own.

**Which compose service to override.** The panel parses the base file's
`services:` map and auto-detects it. Exactly one service → use it. Zero or
several → the start fails with an error naming the file and the services found,
and the settings tab shows the same message inline. No silent guess: overriding
the wrong service in a multi-service stack would be worse than refusing.

The shipped files each declare exactly one service, so detection succeeds today:

| Service | File | `services:` key | Shipped image |
|---|---|---|---|
| ipcame | `ipcame/docker-compose.yml` | `app` | `registry.gitlab.com/laoitdev/23-s-asian-ipcame-service` |
| rfid | `rfid/docker-compose.yml` | `rfid_gate_service` | `registry.gitlab.com/laoitdev/23-s-asian-rfid-gate-service` |

Both shipped refs are **untagged**, so they resolve to `:latest`. That is
precisely the case always-pull exists for: an untagged ref is only re-resolved
when the tag is re-pulled, so a running gate would otherwise keep a stale image
indefinitely. Validation must therefore accept an untagged ref, not require a
tag.

Both are private `registry.gitlab.com` refs, authenticated by the `docker login`
that `setup.sh` performs. Credentials can expire, which is the concrete
motivation for the local-image fallback above.

**Pull policy.** `always` (default) runs `docker compose pull <service>` before
every `up -d`. When the image is already current this costs one manifest
round-trip and downloads no layers, so it is nearly free. `never` skips the
pull and starts with whatever is local.

**Pull failure.** If the registry is unreachable or the credential is expired
but the image is already local, the start continues with a `warn` event naming
the pull error. Only a pull failure with no local image to fall back on fails
the start.

**No automatic updates.** Images change only when a service is started, or via
the explicit pull action in §10. The panel never updates a running gate on its
own. Updating a live gate needs a `down` + `up`, which means downtime — that is
the user's call, not a scheduler's.

**Validation.** The image ref must match
`^[a-zA-Z0-9][\w.\-/:@]*(:[a-zA-Z0-9][\w.\-]*)?$` — enough to exclude
whitespace and shell metacharacters, since the ref reaches `docker compose` as
an argument in a generated file. A leading `-` is rejected outright so a ref can
never be read as a flag.

## 9. Configuration editor

### 9.1 Schema

`config/schema.ts` declares, per file, an ordered list of sections. Each field:

```ts
type Field = {
  key: string;              // the raw toml key — shown as a small mono hint only
  label: string;            // human-readable title, e.g. "Reader IP address"
  help?: string;            // rendered from the canonical TOML comment
  type: 'string' | 'number' | 'boolean' | 'enum' | 'array<object>';
  enum?: { value: string | number; label: string }[];  // value=raw, label=human
  min?: number; max?: number; step?: number;
  default?: unknown;
  arrayOf?: Section;        // for [[antennas]], [[ipcame]], [[gates]]
};
type Section = { key: string; label: string; fields: Field[]; isArray?: boolean };
```

**Presentation rule (UX):** the field *title* is always `label`, never the raw
toml key. The raw key is rendered beneath it in small monospace (and as the
input's `title`/tooltip) so an operator can trace it back to the file without
reading identifiers as headings. Enum values display `label`, not the raw
`value`. Array sections render as grids with human column headers (e.g.
"Antenna #", "Tx power (dBm)", "Rx sensitivity", "Enabled").

Three schemas:

- **Reader** (`config.toml`): `reader_name`, `speedway_address`, `socket_port`,
  `session`, `tag_population`, `rf_mode` (enum of the 10 documented modes),
  `selected_search_mode` (enum), `[filter]` (`enabled`, `tag_mask`, `bit_count`),
  `[[antennas]]` (`ant_id`, `tx_power`, `rx_sensitivity`, `enable`).
- **Cameras** (`ipcame/config.toml`): `SERVICE_PORT`, `SAVE_CAMERA_IMAGE_DIR_NAME`,
  `image_width`, `image_height`, `rotate` (enum), `[[ipcame]]` (`IP_CAMERA_ADDRESS`,
  `RTSP_PORT`, `IP_CAMERA_USER`, `IP_CAMERA_PASSWORD`, `IP_CAMERA_CHANNEL`,
  `relate_gate_id`). Password field uses a masked input.
- **Gate RFID** (`rfid/config/config.toml`): `socket_address`, `socket_port`,
  `tx_power`, `receiver_sensitivity_index`, `mqtt_broker_address`, `mqtt_user`,
  `mqtt_passwd`, `cleanup_interval`, `report_every_n_tags`, `search_mode`,
  `tag_timeout`, `tag_population`, `event_id`, `[[gates]]` (`gate_id`, `ant`,
  `ipcame_gateway_address`, `ipcame_port`, `camera_id`).

Every field carries its original TOML comment as `help`, so the UI explains the
same values the source file documented.

### 9.2 Read/write

- `readConfig(file, base)` parses the TOML and maps known keys into form values;
  unknown keys are kept in a `_extra` bag.
- `writeConfig(file, base, values)` builds a fresh TOML document from the schema
  order, emitting each field's canonical comment, then reattaches `_extra` keys
  so nothing unknown is lost. Writes are atomic (temp file + rename) after a
  `.bak` copy of the previous file.
- Validation runs (Zod, derived from the schema) before write; failures return
  field-level errors and no write happens.
- Changing `socket_port` in the reader config and the matching `socket_port` in
  the Gate RFID config are surfaced as a linked-field hint (they must match for
  the reader→rfid link to work), but not auto-coupled.

## 10. Screens

1. **`/setup-pin`** — first run only. Centered card, PIN pad, two entries
   (enter + confirm), 6–12 digits, note that 5 wrong tries locks for 15 min.
   Submit creates the PIN and logs in.
2. **`/login`** — same centered card, PIN pad. Shows lockout state and minutes
   remaining when rate-limited.
3. **`/` (main control)** — the **L2 split layout**: left column holds the
   control surface, right column is the **docked live log** (dark panel, full
   height, always visible).
   - Left top: an **overall status banner** — green OPERATIONAL or red/amber
     DEGRADED, with the failing service and cause inline.
   - Left: **global controls** — `START ALL` / `STOP ALL`, with a small caption
     showing the order (1 reader → 2 ipcame → 3 gate-rfid; stop reversed).
   - Left: three **per-service rows**, numbered by start order. Each row shows
     the human service name, its port/container note, a state line
     (● RUNNING · pid / container / uptime, or ● PULLING · image, or ● ERROR ·
     reason), and a single
     Start/Stop toggle button enabled only when that action is valid (not
     mid-transition). Starting a service whose dependency is down opens a
     confirmation dialog naming the missing dependencies.
   - Right: **live log console** over SSE — level colors, timestamp, service
     tag, `[system]` events for user actions, auto-scroll toggle, expandable
     `detail` on failures.
4. **`/setup`** — if the project is not installed: form for Docker
   username/password and the install path (default `~/Desktop/asean-project`),
   a **Run setup** button, and a streamed install console with step checkmarks
   (update → docker → download → extract → syncthing → docker login). If
   installed: shows the detected path and version markers, with a **Re-run
   setup** action behind a confirmation.
5. **`/settings`** — tabs Reader / Cameras / Gate RFID / **Docker images**. The
   first three are a set of section cards containing **full typed forms** for
   every field, with human-readable labels (raw toml key as a small mono hint,
   per §9.1) and repeatable `[[antennas]]` / `[[ipcame]]` / `[[gates]]` grids
   with add/remove rows. Live validation. A **Revert** / **Save** bar; a
   read-only raw-TOML preview of the pending result is available before saving.
   Save writes the TOML atomically and reports success or field-level errors.

   **Docker images** tab (not TOML — backed by `app_config`, per §8.6) holds one
   card per docker service:
   - The compose file path and the **auto-detected compose service name**, shown
     as mono text. When detection fails, the card renders an inline error naming
     the file and the services found — not a toast — and disables Save.
   - An **image** field (`repo:tag`), the human label with the `app_config` key
     as a mono hint. Empty means "use the compose file's own image", stated in
     the field help.
   - A **pull policy** select: `always` / `never`.
   - **Pull now** — streams pull progress into a console on the card, ending in
     the resolved digest. Available whether or not the service is running.
   - The **effective image** and its **local digest**, when one is present, so a
     stale image is visible without starting anything.
   - A note that the reader service is not listed here because it is a binary,
     not an image.

   Changing the image or policy takes effect at the next start — the tab says so
   rather than implying an immediate update.

### 10.1 Visual language — "Soft Dark"

Approved direction (A1). Dark app chrome, light content:

- **Chrome** (top bar, log wells): dark slate — `#273244` bar, `#1e293b` log
  panel. App title + nav (`Status · Setup · Settings`) live here.
- **Canvas / cards**: soft blue-gray canvas (`#e9eef4`) with white cards,
  `#dbe3ec` hairline borders, subtle shadow.
- **Status semantics**: green `#16a34a` running, amber `#f59e0b` transitioning /
  warning, red `#dc2626` error. Cards carry a colored top or left status bar
  and a glowing status dot.
- **Primary action**: green filled button for START; destructive/neutral outline
  for STOP (red fill on the per-service Stop). Indigo/blue only for non-service
  primary actions (Save).
- **Typography**: system sans for UI; monospace (ui-monospace / Menlo) for the
  log console, numeric/address fields, and raw-key hints.

Design tokens (colors, radii, spacing) live in one place and are exposed to
Tailwind + shadcn-svelte so all surfaces stay consistent.

## 11. Error handling

- Every service action returns a structured result
  `{ ok, service?, code?, message, detail? }`. The UI renders `message` as the
  human explanation and `detail` (stderr tail, exit code, docker error) on
  demand.
- Docker absent / daemon down → clear "Docker is not available" error with the
  raw docker stderr.
- Missing project path / files → explicit "project not installed" state that
  routes the user to `/setup`.
- All server errors are logged via `log.ts` with a request id; the API returns
  the request id for correlation. No stack traces leak to the client.

## 12. Testing

**Vitest (unit / integration):**
- `auth`: hash+verify round trip; wrong PIN rejected; `timingSafeEqual` path;
  rate-limit lockout after 5 failures and recovery after window; session
  create/validate/expire/destroy.
- `config/schema` + `store`: parse→form→write round trip for all three files;
  comments emitted; unknown keys preserved; array sections round-trip; atomic
  write leaves a `.bak`; validation rejects out-of-range.
- `services/manager`: full state machine with `child_process` and docker layer
  mocked — `startAll` order (reader, ipcame, rfid), `stopAll` order reversed,
  per-service `startOne`/`stopOne` independent of the others, dependency guard
  (start rfid with reader/ipcame down → `dependency_down` unless `force`),
  failure at each step produces `error` with detail and aborts `startAll`,
  `stopAll` continues past a failure and reports all errors, idempotency,
  reconciliation of a stale PID and of an orphaned docker stack.
- `proc/docker`: parses `compose ps` output; builds correct argv per directory.
- `proc/compose`: `detectComposeService` returns the single service for a
  one-service file, throws for zero and for several; `renderOverride` output
  parses back as YAML and merges over the base with the image replaced;
  `composeArgs` omits `-f <override>` when no image is configured; the override
  is written atomically and regenerated (not appended to) on a second write.
- `images`: `validateImageRef` accepts `repo:tag`, `registry:5000/repo:tag`,
  and a digest form, and rejects empty-ish, whitespace, shell metacharacters,
  and a leading `-`; `resolveImage` prefers `app_config` over the compose image;
  `pull` failure with a local image present yields a `warn` result, not a
  failure; `pull` failure with no local image fails.
- `services/manager` (docker image path): `startOne('ipcame')` with an image
  configured asserts the argv sequence `-f base -f override pull` then
  `up -d`; `pulling` is emitted before `starting`; policy `never` skips the
  pull entirely.

**Playwright (e2e):**
- First run → create PIN → redirected to main.
- Reload → session persists; logout → login required.
- Wrong PIN ×5 → lockout message.
- Main screen: per-service rows show correct state; a single row's Start/Stop
  changes only that service; START ALL / STOP ALL drive all three in order;
  dependency guard dialog appears when starting gate-rfid alone; logs stream.
- Settings: edit a field by its human label, save, reload, value persisted;
  raw toml key shown as hint; invalid value blocked.
- Settings → Docker images: set an image, save, reload, value persisted; an
  ambiguous compose file renders the inline error naming the services found and
  disables Save; Pull now streams a progress console.

Service-control e2e uses a fake project fixture (a shell script that stands in
for the binary and a no-op compose shim) so the suite runs without Docker.

## 13. Non-goals (YAGNI)

- Multi-user / roles.
- Remote telemetry, cloud sync, alerting dashboards.
- Reading live tag/camera data (that is the services' job).
- Editing `syncthing.service` or system-level files from the UI.
- Auto-updating the webapp itself.
- **Automatic image updates while a service is running.** Images change on start
  or on an explicit pull only (§8.6). A scheduler that recreated a live gate
  would cause unrequested downtime.
- **Updating the reader binary.** It is a spawned binary, not an image, and has
  no update path here.

## 14. Open risks

- **Platform.** `setup.sh` and the binary are Linux-only; service-control and
  setup paths cannot be fully exercised on the macOS dev machine. Mitigation:
  mock those layers in tests; integration-verify on the gate box.
- **Docker from the webapp user.** The webapp process must be in the `docker`
  group (setup.sh adds the user). Documented in the README; a startup check
  reports a clear error if `docker` is not reachable.
- **Comment fidelity.** Regenerated TOML reflects schema-defined comments;
  free-form comments a user added by hand outside known keys are not preserved
  (unknown *keys* are; unknown *comments* are not). Documented in the UI.
- **Compose override assumption.** The override sets `image:` on a service the
  panel detects by parsing the base file. If a compose file builds the image
  locally (`build:`) instead of pulling one, the override replaces that with a
  pulled ref — which is the intent when an image is configured, but is a
  behavior change the user should know about. The settings card states it.
  Multi-service files are refused rather than guessed, so the wrong service is
  never overridden silently.
- **Slower START ALL.** Always-pull makes a cold start network-bound, and a
  slow registry shows as a long `pulling` state. Mitigation: the state is
  visible per row (§8.1) and pulls stay inline, so the reader still comes up
  while ipcame pulls.

## 15. UI mockups (approved)

Visual mockups produced during brainstorming are kept under
`.superpowers/brainstorm/<session>/content/`:

- `visual-style.html` → `visual-style-v2.html` — direction pick; **A1 Soft Dark**
  chosen.
- `layout.html` — layout pick; **L2 split, docked log** chosen.
- `per-service-controls.html` — per-service rows + START ALL / STOP ALL;
  approved.
- `settings-auth.html` → `settings-labels-v2.html` — settings editor; approved
  with human-readable labels and raw toml key demoted to a mono hint.

These are the authoritative reference for the visual language in §10.1.
