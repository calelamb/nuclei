import { expect, test } from '@playwright/test';

const FIXTURE_URL = '/?e2eProject=qec-project&workspace=research';

test.describe('the cascade renders the same in dev and in the shipped build', () => {
  test('the boot placeholder is top-aligned in the results column (component CSS outranks the primitive)', async ({ page }) => {
    await page.goto(FIXTURE_URL);
    const title = page.locator('.viz-empty--boot .nuclei-empty__title');
    await expect(title).toBeVisible();
    const top = await title.evaluate((el) => Math.round(el.getBoundingClientRect().top));
    expect(top).toBeLessThan(120);
    const justify = await page.locator('.viz-empty--boot').evaluate((el) => getComputedStyle(el).justifyContent);
    expect(justify).toMatch(/flex-start|start/);
  });
});

test.describe('keyboard navigation ends with focus somewhere meaningful', () => {
  test('Cmd+4 opens Hardware and moves focus to its sidebar heading, so the next Tab never indents code', async ({ page }) => {
    await page.goto(FIXTURE_URL);
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await page.locator('.monaco-editor').first().click({ position: { x: 200, y: 80 } });
    await page.keyboard.press('Meta+4');
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('H2');
    await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe('Hardware');
  });
});
