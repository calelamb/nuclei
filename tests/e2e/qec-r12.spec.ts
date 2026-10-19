import { expect, test } from '@playwright/test';

const FIXTURE_URL = '/?e2eProject=qec-project&workspace=research';
const DIALOG_BODY_WIDTH = 466;

async function openNoiseCompare(page: import('@playwright/test').Page, model: string): Promise<void> {
  await page.goto(FIXTURE_URL);
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await page.getByRole('button', { name: /Experiments/i }).first().click();
  await page.getByRole('button', { name: /Noise models/i }).first().click();
  await expect(page.getByRole('dialog', { name: 'Noise model library' })).toBeVisible();
  await page.getByLabel('Compare with').selectOption(model);
}

test.describe('Noise comparison fits the dialog (qec-r-90, qec-r-91)', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`${theme}: both model columns fit at ${DIALOG_BODY_WIDTH}px with every value visible`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await openNoiseCompare(page, 'measurement_heavy');
      const region = page.getByRole('region', { name: 'Generator argument differences' });
      await expect(region).toBeVisible();
      const { scrollWidth, clientWidth } = await region.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
      expect(clientWidth).toBe(DIALOG_BODY_WIDTH);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      const cells = region.locator('td.nuclei-table__num');
      expect(await cells.allTextContents()).toEqual(['1', '0', '1', '10', '1', '0']);
      for (const box of await cells.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().right))) {
        const edge = await region.evaluate((el) => el.getBoundingClientRect().right);
        expect(box).toBeLessThanOrEqual(edge);
      }
    });
  }
});
