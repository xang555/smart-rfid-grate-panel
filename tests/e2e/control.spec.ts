import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { E2E_DB_PATH } from './e2e-db';

const FIXTURE = path.resolve('tests/fixtures/fake-project');

// Serial by config (workers: 1). auth.spec runs first and creates the panel
// PIN; these tests sign in with it. The project_path is pointed at a
// disposable copy of the fixture so writes never touch real config.
async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  // no submit button: the sixth digit signs in on its own
  await page.getByLabel('PIN').fill('135790');
  await expect(page).toHaveURL('http://localhost:5273/');
}

function seedProjectPath(dbPath: string, projectPath: string) {
  execFileSync(
    process.execPath,
    [
      '-e',
      `const D=require('better-sqlite3');
       const db=new D(process.argv[1]);
       db.prepare("INSERT INTO app_config (key,value) VALUES ('project_path',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(process.argv[2]);
       db.close();`,
      dbPath,
      projectPath
    ],
    { cwd: process.cwd() }
  );
}

test('settings edits persist to the toml file', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-proj-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  seedProjectPath(E2E_DB_PATH, dir);

  await signIn(page);
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Reader', exact: true }).click();
  await page.getByLabel('Reader IP address').fill('10.20.30.40');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  expect(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8')).toContain('10.20.30.40');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('per-service control is independent and gated', async ({ page }) => {
  await signIn(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // three numbered rows in start order
  const rows = page.locator('[data-service-row]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Reader');
  await expect(rows.nth(1)).toContainText('IP Camera');
  await expect(rows.nth(2)).toContainText('Gate RFID');

  // Gate RFID alone is refused; the dialog names its dependencies
  await rows.nth(2).getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('dialog')).toContainText('Reader');
  await expect(page.getByRole('dialog')).toContainText('IP Camera');
});
