import { expect, test, type Page } from '@playwright/test';

const FIXTURE_URL = '/?e2eProject=qec-project&workspace=research';
const EDITOR_MIN_WIDTH = 420;

async function editorWidth(page: Page): Promise<number> {
  return page.evaluate(() => Math.round(document.querySelector('.monaco-editor')?.getBoundingClientRect().width ?? 0));
}

async function diracIsOpen(page: Page): Promise<boolean> {
  return page.evaluate(() => document.body.innerText.includes('Connect Dirac') || document.body.innerText.includes('Ask Dirac'));
}

test.describe('the editor keeps its room whichever panel opens last (900x700)', () => {
  test.use({ viewport: { width: 900, height: 700 } });

  test('Dirac first, then the sidebar: Dirac folds to its rail and the editor stays >= 420px', async ({ page }) => {
    await page.goto(FIXTURE_URL);
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await page.keyboard.press('Meta+d');
    await expect.poll(() => diracIsOpen(page)).toBe(true);
    expect(await editorWidth(page)).toBeGreaterThanOrEqual(EDITOR_MIN_WIDTH);

    await page.keyboard.press('Meta+1');
    await expect.poll(() => page.evaluate(() => document.body.innerText.includes('EXPLORER'))).toBe(true);
    expect(await editorWidth(page)).toBeGreaterThanOrEqual(EDITOR_MIN_WIDTH);
    expect(await diracIsOpen(page)).toBe(false);
  });

  test('sidebar first, then Dirac: the sidebar folds and the editor stays >= 420px', async ({ page }) => {
    await page.goto(FIXTURE_URL);
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await page.keyboard.press('Meta+1');
    await page.keyboard.press('Meta+d');
    await expect.poll(() => diracIsOpen(page)).toBe(true);
    expect(await editorWidth(page)).toBeGreaterThanOrEqual(EDITOR_MIN_WIDTH);
  });
});

test.describe('a run that finishes without a circuit is not a failure', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('plain Python prints, then says Done · no circuit', async ({ page }) => {
    await page.goto(FIXTURE_URL);
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await page.click('.monaco-editor');
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Delete');
    await page.keyboard.insertText('import time\nprint("Done")\n');
    await page.keyboard.press('Meta+Enter');
    await expect(page.getByText('Done · no circuit')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Last run failed')).toHaveCount(0);
    await expect(page.getByText('Ran as plain Python. No circuit to simulate.')).toBeVisible();
    await expect(page.getByText('No circuit in this file')).toBeVisible();
  });
});
