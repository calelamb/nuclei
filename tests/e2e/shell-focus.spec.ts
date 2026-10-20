import { expect, test, type Page } from '@playwright/test';

/** Shell navigation and focus contract: the rail, the keys and the palette agree, and focus is never on <body>. */
const LEARN_URL = '/?e2eProject=qec-project&workspace=learn';

async function activeIsReal(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement !== null && document.activeElement !== document.body);
}

async function openPalette(page: Page, query: string) {
  await page.keyboard.press('ControlOrMeta+Shift+P');
  await page.keyboard.type(query);
  await page.keyboard.press('Enter');
}

const SURFACE = () => ({
  takeover: document.querySelector('[data-takeover] h1, [data-takeover] h2')?.textContent ?? null,
  sidebar: document.querySelector('[data-nav-landing]')?.textContent ?? null,
});

test.describe('shell navigation agrees across the rail, the keys and the palette', () => {
  for (const [rail, key, palette] of [
    ['Challenges', 'ControlOrMeta+3', 'Go to Challenges'],
    ['Learning', 'ControlOrMeta+2', 'Go to Learning'],
  ] as const) {
    test(`${rail}: key and palette open the same full view as the rail, and focus lands in it`, async ({ page }) => {
      await page.goto(LEARN_URL);
      const railButton = page.getByRole('button', { name: new RegExp(`^${rail}`) }).first();
      await railButton.click();
      await expect.poll(async () => (await page.evaluate(SURFACE)).takeover).not.toBeNull();
      const viaRail = await page.evaluate(SURFACE);
      expect(viaRail.takeover).not.toBeNull();
      await railButton.click(); // back to the editor

      await page.locator('.monaco-editor').first().click();
      await page.keyboard.press(key);
      await expect.poll(() => page.evaluate(SURFACE)).toEqual(viaRail);
      expect(await activeIsReal(page)).toBe(true);
      expect(await page.evaluate(() => document.activeElement?.closest('[data-takeover]') !== null)).toBe(true);

      await railButton.click();
      await openPalette(page, palette);
      await expect.poll(() => page.evaluate(SURFACE)).toEqual(viaRail);
    });
  }

  test('inside a lesson the palette offers no editor-only commands', async ({ page }) => {
    await page.goto(LEARN_URL);
    await page.getByRole('button', { name: /^Learning/ }).first().click();
    await page.keyboard.press('ControlOrMeta+Shift+P');
    const options = await page.getByRole('option').allTextContents();
    expect(options.join('|')).not.toMatch(/Run circuit|Step through|New file|Toggle (circuit|bloch|histogram|terminal)/i);
  });
});

test.describe('focus is never on <body> after a collapse or a mode switch', () => {
  test('Cmd+Shift+M from the Level chip lands on the mode chip', async ({ page }) => {
    await page.goto(LEARN_URL);
    await page.getByRole('button', { name: /^Level:/ }).focus();
    await page.keyboard.press('ControlOrMeta+Shift+M');
    await expect(page.getByRole('button', { name: 'Switch workspace mode' })).toBeFocused();
  });

  test('Cmd+` twice in Clean leaves no Terminal strip behind', async ({ page }) => {
    await page.goto('/?e2eProject=qec-project&workspace=research');
    await page.locator('.monaco-editor').first().click();
    await page.keyboard.press('ControlOrMeta+`');
    await expect(page.getByRole('tab', { name: 'Terminal' })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+`');
    await expect(page.getByRole('tab', { name: 'Terminal' })).toHaveCount(0);
  });
});

const headingFocused = (page: Page) => page.evaluate(() => {
  const a = document.activeElement;
  return a && /^H[12]$/.test(a.tagName) ? a.textContent?.trim() ?? '' : null;
});

test.describe('every route lands focus on a visible heading, cold or warm', () => {
  test('Cmd+2 then Cmd+3 on a cold session lands on the Challenges heading, not <body> (shell-r9-01)', async ({ page }) => {
    await page.goto(LEARN_URL);
    await page.locator('.monaco-editor').first().click();
    await page.keyboard.press('ControlOrMeta+2');
    await expect.poll(() => headingFocused(page)).toMatch(/Learn/i);
    await page.keyboard.press('ControlOrMeta+3');
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-takeover="challenges"]') !== null)).toBe(true);
    await expect.poll(() => headingFocused(page)).not.toBeNull();
  });

  test('leaving a takeover by key lands on the sidebar heading, not the editor (shell-r9-02)', async ({ page }) => {
    await page.goto(LEARN_URL);
    await page.locator('.monaco-editor').first().click();
    await page.keyboard.press('ControlOrMeta+2');
    await expect.poll(() => headingFocused(page)).not.toBeNull();
    await page.keyboard.press('ControlOrMeta+4');
    await expect.poll(() => headingFocused(page)).toMatch(/launch/i);
    await page.waitForTimeout(400);
    expect(await headingFocused(page)).toMatch(/launch/i);
  });

  test('a rail tooltip is gone once a modal takes focus (shell-r9-03)', async ({ page }) => {
    await page.goto(LEARN_URL);
    await page.getByRole('button', { name: 'Switch workspace mode' }).hover();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await openPalette(page, "what's new");
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });

  test('Replay in Settings gets focus back when the tour ends (shell-r8-02)', async ({ page }) => {
    await page.goto('/?e2eProject=qec-project&workspace=research');
    await page.getByRole('button', { name: /^Settings/ }).first().click();
    const replay = page.getByRole('button', { name: 'Replay' });
    await replay.click();
    await page.keyboard.press('Escape');
    await expect(replay).toBeFocused();
  });
});

test.describe('rail clicks keep focus on the rail', () => {
  test('leaving a takeover by clicking a rail icon does not drop focus into the editor', async ({ page }) => {
    await page.goto(LEARN_URL);
    await page.getByRole('button', { name: /^Learning/ }).first().click();
    await expect.poll(async () => (await page.evaluate(SURFACE)).takeover).not.toBeNull();
    const explorer = page.getByRole('button', { name: /^Explorer/ }).first();
    await explorer.click();
    await expect.poll(async () => (await page.evaluate(SURFACE)).takeover).toBeNull();
    for (const wait of [50, 300, 1200]) {
      await page.waitForTimeout(wait);
      expect(await page.evaluate(() => document.activeElement?.closest('.monaco-editor') ?? null)).toBeNull();
    }
    await expect(explorer).toBeFocused();
  });
});
