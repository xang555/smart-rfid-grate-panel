import path from 'node:path';

// Throwaway database for the e2e run, so specs never read or write the dev DB
// at /data/app.db. playwright.config.ts wipes it before each run and points
// the dev server at it; specs that seed state must open the same file.
export const E2E_DB_DIR = path.resolve('test-results/e2e-db');
export const E2E_DB_PATH = path.join(E2E_DB_DIR, 'app.db');
