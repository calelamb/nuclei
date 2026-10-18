import { expect, test } from '@playwright/test';

/**
 * Needs the Pyodide web build: `npm run build:web && npm run preview:web -- --port 7911`,
 * then NUCLEI_WEB_URL=http://127.0.0.1:7911/try/ npx playwright test web-run-after-edit.
 */
const WEB_URL = process.env.NUCLEI_WEB_URL;
const HEAVY_PROGRAM = [
  'from qiskit import QuantumCircuit',
  'qc = QuantumCircuit(1, 1); qc.h(0); qc.measure(0, 0)',
  "s = sum(i * i for i in range(40000000)); print('finished', s)",
].join('\n');

test('@web a healthy 8 s program run right after editing ends Done, never a 120 s timeout', async ({ page }) => {
  test.skip(!WEB_URL, 'set NUCLEI_WEB_URL to the web preview to run this check');
  test.setTimeout(150_000);
  await page.goto(WEB_URL as string);
  await page.getByText('Research workspace').first().click();
  const skip = page.getByText('Skip', { exact: true });
  if (await skip.count()) await skip.first().click();
  await expect(page.getByText(/Python ready/).first()).toBeVisible({ timeout: 90_000 });

  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(HEAVY_PROGRAM);
  await page.waitForTimeout(1_200); // the live preview starts evaluating the heavy line
  await page.keyboard.press('ControlOrMeta+Enter');

  await expect(page.getByText(/Done · /).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/ran for more than/)).toHaveCount(0);
  await expect(page.getByText('Last run failed')).toHaveCount(0);
});
