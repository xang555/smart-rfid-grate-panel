import { test, expect } from '@playwright/test';

// The dev database persists between runs, so the gated entry point is
// /setup-pin on a fresh install and /login once a PIN exists. Both prove the
// session guard is alive. Screen contents are covered by auth.spec (Task 19).
test('unauthenticated visit lands on a gated screen', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/(setup-pin|login)$/);
});
