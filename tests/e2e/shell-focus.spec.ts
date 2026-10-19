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
