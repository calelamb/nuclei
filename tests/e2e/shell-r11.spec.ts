import { expect, test, type Page } from '@playwright/test';

/** Round 11 shell contract: the Research tour is modal to the keyboard, and resizing never moves focus. */
const RESEARCH_URL = '/?e2eProject=qec-project&workspace=research';

async function openResearch(page: Page) {
  await page.goto(RESEARCH_URL);
  await expect(page.locator('.monaco-editor').first()).toBeVisible();
  await page.waitForTimeout(800); // Monaco takes focus once it mounts; let that settle before the shortcut
}

const activeDescription = (page: Page) => page.evaluate(() => {
  const a = document.activeElement;
  return a === null || a === document.body ? 'body' : `${a.tagName}|${a.getAttribute('aria-label') ?? a.textContent?.trim().slice(0, 24)}`;
});

test.describe('Research tour is modal to the keyboard (interaction-r-01, learn-r11-01)', () => {
  test('no global shortcut acts behind the tour, and Escape ends it', async ({ page }) => {
    await openResearch(page);
    await page.keyboard.press('ControlOrMeta+,');
    await page.getByRole('button', { name: 'Replay' }).click();
    const tour = page.locator('.research-tour__card');
    await expect(tour).toBeVisible();

    const sidebarTitle = () => page.evaluate(() => document.querySelector('[data-nav-landing]')?.textContent ?? null);
    const before = await sidebarTitle();
    await page.keyboard.press('ControlOrMeta+Shift+P');
    await page.keyboard.press('ControlOrMeta+3');
    await page.keyboard.press('ControlOrMeta+Shift+M');
    await page.waitForTimeout(300);
    // none of the above reached the app: still Research, still the same sidebar
    await expect(page.getByRole('dialog')).toHaveCount(1); // the tour is the only dialog: no palette opened
    await expect(tour).toBeVisible();
    expect(await sidebarTitle()).toBe(before);
    await expect(page.locator('[aria-label="Switch workspace mode"]')).toContainText(/research/i);

    await page.keyboard.press('Escape');
    await expect(tour).toHaveCount(0);
  });
});

test.describe('resizing never moves focus (shell-r11-02)', () => {
  test('Settings keeps focus and its mounted sidebar through 1440 -> 1100 -> 1440', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openResearch(page);
    await page.keyboard.press('ControlOrMeta+,');
    await expect.poll(() => activeDescription(page)).toBe('H2|Settings');
    await page.evaluate(() => document.querySelector('[data-nav-landing]')?.setAttribute('data-mounted-marker', '1'));

    await page.setViewportSize({ width: 1100, height: 800 });
    await page.waitForTimeout(600);
    expect(await activeDescription(page)).toBe('H2|Settings');
    expect(await page.locator('[data-mounted-marker]').count()).toBe(1); // not unmounted and remounted on the way
    expect(await page.locator('[role="tooltip"]:visible').count()).toBe(0);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(600);
    expect(await activeDescription(page)).toBe('H2|Settings');
  });

  test('a sidebar that folds at 900 with focus inside lands on its rail button', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await openResearch(page);
    await page.keyboard.press('ControlOrMeta+,');
    await expect.poll(() => activeDescription(page)).toBe('H2|Settings');
    await page.setViewportSize({ width: 900, height: 800 });
    await page.waitForTimeout(600);
    expect(await activeDescription(page)).toBe('BUTTON|Settings');
  });

  test('Settings lands on its heading with no ring', async ({ page }) => {
    await openResearch(page);
    await page.keyboard.press('ControlOrMeta+,');
    await expect.poll(() => activeDescription(page)).toBe('H2|Settings');
    expect(await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle)).toBe('none');
  });
});
