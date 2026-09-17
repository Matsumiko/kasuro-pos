import { expect, test } from '@playwright/test';

test.describe('public and authenticated navigation', () => {
  test('public CTAs resolve to real pages', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Mulai gratis' })).toBeVisible();
    await page.getByRole('link', { name: 'Lihat fitur' }).click();
    await expect(page).toHaveURL(/\/features$/);
    await expect(
      page.getByRole('heading', { name: 'Semua yang penting, terlihat jelas.' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Mulai gratis' }).click();
    await expect(page).toHaveURL(/\/register$/);
  });

  test('protected operational routes redirect anonymous users', async ({ page }) => {
    for (const path of [
      '/app/products/new',
      '/app/inventory/adjustments',
      '/app/sales',
      '/app/sales/example',
      '/app/refunds',
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test('operational shell has no mobile horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/app/inventory');
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/features');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
});
