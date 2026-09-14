import { test, expect } from '@playwright/test';

// Serial by config (workers: 1). The dev DB starts empty: the first test
// creates the panel PIN, later tests exercise the login path against it.
// Vite dev hydration can lag the first paint, so wait for the network to
// settle before interacting or the click hits a dead form.
async function settled(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle');
}

test('create a pin then reach the main screen', async ({ page }) => {
  await page.goto('/setup-pin');
  await settled(page);
  await page.getByLabel('PIN', { exact: true }).fill('135790');
  await page.getByLabel('Confirm PIN').fill('135790');
  await page.getByRole('button', { name: 'Create PIN' }).click();
  await expect(page).toHaveURL('http://localhost:5273/');
});

test('after a pin exists, setup-pin bounces to login and signing in works', async ({ page }) => {
  await page.goto('/setup-pin');
  await settled(page);
  // the hook bounces us to /login once a pin exists and we are signed out
  await expect(page).toHaveURL(/\/login$/);
  // the sixth digit submits on its own: there is no button to press
  await page.getByLabel('PIN').fill('135790');
  await expect(page).toHaveURL('http://localhost:5273/');
});

test('wrong pin shows an error', async ({ page }) => {
  await page.goto('/login');
  await settled(page);
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0);
  await page.getByLabel('PIN').fill('000000');
  await expect(page.getByRole('alert')).toContainText('Incorrect');
});

test('signing out drops the session and returns to the gate', async ({ page }) => {
  await page.goto('/login');
  await settled(page);
  await page.getByLabel('PIN').fill('135790');
  await expect(page).toHaveURL('http://localhost:5273/');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // the session is gone, so the guarded screen bounces back out
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});
