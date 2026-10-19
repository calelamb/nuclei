import { expect, test, type Page } from '@playwright/test';

/** Round 12 shell lane: programmatic focus lands quietly, with the ring and nothing else. */
const RESEARCH_URL = '/?e2eProject=qec-project&workspace=research';
const LEARN_URL = '/?e2eProject=qec-project&workspace=learn';

// Some chrome keeps empty role=tooltip hosts mounted; only a tooltip with text is visible to a person.
const visibleTooltips = (page: Page) => page.locator('[role="tooltip"]', { hasText: /\S/ }).count();

async function openFirstLesson(page: Page) {
  await page.goto(LEARN_URL);
  await page.getByRole('button', { name: /^Learning/ }).first().click();
  await page.getByRole('button', { name: /Quantum Computing Fundamentals/ }).first().click();
  await page.locator('button', { hasText: /What is Quantum Computing/ }).first().click();
  await expect(page.getByRole('heading', { name: /What is Quantum Computing/, level: 1 })).toBeVisible();
}

test.describe('resize and tooltips (shell-r12-01)', () => {
  test('a resize fold pops no tooltip and none outlives the resize back', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(RESEARCH_URL);
    await page.locator('.monaco-editor').first().click();
    await page.waitForTimeout(800); // past the tooltip's "focus right after a mouse press" window
    await page.keyboard.press('ControlOrMeta+,');
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-tour-sidebar]') !== null)).toBe(true);
    await page.setViewportSize({ width: 900, height: 600 });
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '')).toContain('Settings');
    await page.waitForTimeout(700);
    expect(await visibleTooltips(page)).toBe(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(700);
    expect(await visibleTooltips(page)).toBe(0);
  });
});

test.describe('Dirac on the narrow band (shell-r12-02)', () => {
  test('Cmd+D from the Settings landing reaches Dirac, not the Settings rail button', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await page.goto(RESEARCH_URL);
    await page.locator('.monaco-editor').first().click();
    await page.keyboard.press('ControlOrMeta+,');
    await page.keyboard.press('ControlOrMeta+d');
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-dirac-panel]') !== null), { timeout: 3000 }).toBe(true);
    expect(await visibleTooltips(page)).toBe(0);
  });
});

test.describe('lesson navigation focus (learn-r12-01)', () => {
  test('Hide and Show hand focus to each other', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFirstLesson(page);
    const hide = page.getByRole('button', { name: 'Hide lesson navigation' });
    await hide.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Show lesson navigation' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Hide lesson navigation' })).toBeFocused();
  });
});

test.describe('a restored lesson (shell-r12-03)', () => {
  test('lands focus on the restored block, so Tab continues from there instead of jumping to the top', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFirstLesson(page);
    await page.evaluate(() => document.querySelector('.lesson__scroll')?.scrollTo(0, 1600));
    await expect.poll(() => page.evaluate(() => document.querySelector('.lesson__scroll')?.scrollTop ?? 0)).toBeGreaterThan(1000);
    // The reading place is remembered by the scroll-spy; wait for it before leaving.
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('nuclei-lesson-position') ?? '')).not.toBe('');
    await page.keyboard.press('ControlOrMeta+1');
    await expect(page.getByRole('heading', { name: 'Explorer', level: 2 })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+2');
    await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? '')).toMatch(/^block-\d+$/);
    const before = await page.evaluate(() => document.querySelector('.lesson__scroll')?.scrollTop ?? 0);
    await page.keyboard.press('Tab');
    const after = await page.evaluate(() => document.querySelector('.lesson__scroll')?.scrollTop ?? 0);
    expect(Math.abs(after - before)).toBeLessThan(900);
  });
});

test.describe('global Run (interaction-r-02)', () => {
  test('Cmd+Enter runs from the Run button, not only from Monaco', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(RESEARCH_URL);
    await expect(page.getByText('No results yet')).toBeVisible();
    await page.locator('[data-run-button]').focus();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByText(/^Done · /).first()).toBeVisible();
  });
});
