import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // Serial: the auth spec creates the panel PIN that later specs sign in with.
  fullyParallel: false,
  workers: 1,
  webServer: {
    command: 'npm run dev -- --port 5273',
    port: 5273,
    reuseExistingServer: true,
    timeout: 60_000
  },
  use: { baseURL: 'http://localhost:5273' }
});
