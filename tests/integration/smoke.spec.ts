import { expect, test } from '@playwright/test';

test('production card resource loads in an authenticated real Home Assistant frontend', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('home-assistant')).toBeVisible();
  await page.goto('/integration-test/main');
  await expect
    .poll(() => page.evaluate(() => Boolean(customElements.get('vasttrafik-home-assistant-card'))))
    .toBe(true);
  await expect(page.getByText('Integration tests', { exact: true }).first()).toBeVisible();
});
