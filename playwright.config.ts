import fs from 'node:fs';
import { defineConfig } from '@playwright/test';
import { E2E_DB_DIR, E2E_DB_PATH } from './tests/e2e/e2e-db';

// e2e starts from an empty database. The auth spec creates the panel PIN the
// later specs sign in with, so a leftover PIN in the dev DB would make
// /setup-pin bounce straight to /login and the spec time out.
fs.rmSync(E2E_DB_DIR, { recursive: true, force: true });

export default defineConfig({
  testDir: 'tests/e2e',
  // Serial: the auth spec creates the panel PIN that later specs sign in with.
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: 'npm run dev -- --port 5273',
    port: 5273,
    // Never reuse a server someone started by hand: it would be wired to the
    // dev DB and the fresh DB_PATH below would not apply.
    reuseExistingServer: false,
    timeout: 60_000,
    env: { DB_PATH: E2E_DB_PATH }
  },
  use: { baseURL: 'http://localhost:5273' }
});
