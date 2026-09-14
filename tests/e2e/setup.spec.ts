import { test, expect } from '@playwright/test';

// Serial by config (workers: 1). auth.spec runs first and creates the panel
// PIN these tests sign in with. Nothing here lets the installer actually run:
// setup.sh does `apt update`, so every case stops at a client- or server-side
// refusal before the script is spawned.
async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('PIN').fill('135790');
  await expect(page).toHaveURL('http://localhost:5273/');
}

test('setup refuses to start without a download url', async ({ page }) => {
  await signIn(page);
  await page.goto('/setup');
  await page.waitForLoadState('networkidle');

  await page.getByLabel('Docker username').fill('someuser');
  await page.getByLabel('Docker password').fill('somepass');
  await page.getByRole('button', { name: 'Run setup', exact: true }).click();

  await expect(page.getByText('A download URL for the project archive is required.')).toBeVisible();
});

test('setup rejects a download url that is not http', async ({ page }) => {
  await signIn(page);
  await page.goto('/setup');
  await page.waitForLoadState('networkidle');

  await page.getByLabel('Docker username').fill('someuser');
  await page.getByLabel('Docker password').fill('somepass');
  await page.getByLabel('Download URL').fill('file:///etc/passwd');
  await page.getByRole('button', { name: 'Run setup', exact: true }).click();

  await expect(page.getByText('Download URL must be an http or https link')).toBeVisible();
});
