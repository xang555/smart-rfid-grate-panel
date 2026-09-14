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

  // Sign in first: the throwaway DB is created and migrated lazily on the
  // server's first touch, so seeding it any earlier has no schema to insert
  // into.
  await signIn(page);
  seedProjectPath(E2E_DB_PATH, dir);
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

test('a gate antenna list stays a list of numbers', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-proj-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  await signIn(page);
  seedProjectPath(E2E_DB_PATH, dir);

  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Gate RFID', exact: true }).click();

  // the fixture writes `ant = 1`; the field is a list, so it reads as "1"
  const ant = page.getByLabel('Antennas');
  await expect(ant).toHaveValue('1');

  // editing it must not leak a string into the raw preview
  await ant.fill('1, 2');
  await page.getByRole('button', { name: /Show raw TOML/ }).click();
  await expect(page.locator('pre')).toContainText('ant = [ 1, 2 ]');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a config file holding an empty antenna entry shows a clean list', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-proj-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });
  // The shipped fixture nests these keys under [reader_link]/[mqtt]/[behaviour],
  // but the gate schema reads them flat — the real rfid config is flat and the
  // fixture is stale. Write a valid one so the save path is what fails, if
  // anything does. `ant = [""]` stands in for a blank list entry written by an
  // older save.
  const gateCfg = path.join(dir, 'rfid', 'config', 'config.toml');
  fs.writeFileSync(gateCfg, `socket_address = "localhost"
socket_port = 11000
tx_power = 17
receiver_sensitivity_index = 2
mqtt_broker_address = "tcp://localhost:1883"
mqtt_user = "gate"
mqtt_passwd = "changeme"
cleanup_interval = 5
report_every_n_tags = 1
search_mode = 2
tag_timeout = 10
tag_population = 20
event_id = 10001

[[gates]]
gate_id = "10001"
ant = [""]
ipcame_gateway_address = "localhost"
ipcame_port = 5555
camera_id = 1
`);

  await signIn(page);
  seedProjectPath(E2E_DB_PATH, dir);

  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Gate RFID', exact: true }).click();
  await page.getByRole('button', { name: /Show raw TOML/ }).click();

  const pre = page.locator('pre');
  await expect(pre).not.toContainText('[""]');
  await expect(pre).toContainText('ant = []');

  // and a save rewrites the file without the blank entry
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  expect(fs.readFileSync(gateCfg, 'utf8')).toContain('ant = []');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('stopping asks for confirmation and cancel is inert', async ({ page }) => {
  await signIn(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // STOP ALL opens the dialog rather than firing on the click
  await page.getByRole('button', { name: 'STOP ALL' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Stop all services?');

  // Cancel dismisses it and leaves every row where it was
  const before = await page.locator('[data-service-row]').allInnerTexts();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.locator('[data-service-row]').allInnerTexts()).toEqual(before);
});
