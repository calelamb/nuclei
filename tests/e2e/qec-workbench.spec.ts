import { expect, test, type Locator, type Page } from '@playwright/test';

const FIXTURE_URL = '/?e2eProject=qec-project&workspace=research';
const LIGHT_SURFACES = new Set([
  'rgb(255, 255, 255)',
  'rgb(248, 250, 252)',
  'rgb(241, 245, 249)',
  'rgb(240, 249, 255)',
]);

async function openWorkbench(page: Page): Promise<Locator> {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto(FIXTURE_URL);
  await page.getByRole('button', { name: 'QEC Workbench' }).click();
  const workbench = page.getByRole('region', { name: 'QEC Workbench' });
  await expect(workbench).toBeVisible();
  return workbench;
}

async function expectFocusAfterTab(page: Page, target: Locator, limit = 8): Promise<void> {
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  await expect(target).toBeFocused();
}

test('@qec opens the light workbench and switches preset by keyboard', async ({ page }, testInfo) => {
  const workbench = await openWorkbench(page);
  await expect(workbench).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  const study = page.getByRole('combobox', { name: 'Active QEC Study' });
  await expect(study).toHaveJSProperty('tagName', 'SELECT');
  await study.selectOption({ label: 'Surface Memory' });
  await expect(study).toHaveValue('surface-memory');

  const analyze = page.getByRole('button', { name: 'Analyze' });
  await analyze.focus();
  await page.keyboard.press('Enter');
  await expect(analyze).toHaveAttribute('aria-pressed', 'true');

  const surfaces = await workbench.locator('.qec-sources, .qec-investigation, .qec-tray, .qec-instrument__field').evaluateAll(
    (elements) => elements.map((element) => getComputedStyle(element).backgroundColor),
  );
  expect(surfaces.length).toBeGreaterThan(3);
  for (const surface of surfaces) expect(LIGHT_SURFACES.has(surface)).toBe(true);
  const screenshot = testInfo.project.name === 'chromium'
    ? 'qec-workbench-analyze-1440.png'
    : 'qec-workbench-analyze-1024.png';
  await expect(page).toHaveScreenshot(screenshot, { fullPage: true });
});

test('@qec exposes four ordered landmarks and keyboard zones', async ({ page }) => {
  const workbench = await openWorkbench(page);
  await page.getByRole('combobox', { name: 'Active QEC Study' }).selectOption('surface-memory');
  const sources = page.getByRole('navigation', { name: 'QEC sources and data' });
  const canvas = page.getByRole('main', { name: 'QEC investigation canvas' });
  const inspector = page.getByRole('complementary', { name: 'Research inspector' });
  const tray = page.getByRole('region', { name: 'QEC jobs and streams' });

  await expect(sources).toBeVisible();
  await expect(canvas).toBeVisible();
  await expect(inspector).toBeVisible();
  await expect(tray).toBeVisible();
  const landmarks = await workbench.locator('nav[aria-label="QEC sources and data"], main[aria-label="QEC investigation canvas"], aside[aria-label="Research inspector"], section[aria-label="QEC jobs and streams"]').evaluateAll(
    (elements) => elements.map((element) => element.getAttribute('aria-label')),
  );
  expect(landmarks).toEqual([
    'QEC sources and data',
    'QEC investigation canvas',
    'Research inspector',
    'QEC jobs and streams',
  ]);

  const sourceControl = sources.getByRole('button', { name: /Surface Memory/ });
  const canvasControl = canvas.getByRole('button', { name: 'Hide research inspector' });
  const inspectorControl = inspector.getByRole('button', { name: 'Close research inspector' });
  const trayControl = tray.getByRole('button', { name: 'Collapse jobs and streams' });
  await sourceControl.focus();
  await expectFocusAfterTab(page, canvasControl);
  await expectFocusAfterTab(page, inspectorControl);
  await expectFocusAfterTab(page, trayControl);

  await trayControl.press('Enter');
  await expect(tray.getByRole('button', { name: 'Expand jobs and streams' })).toHaveAttribute('aria-expanded', 'false');
  await expect(tray.getByText('No active jobs')).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect.poll(() => workbench.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  const transitionDuration = await page.locator('.qec-source-row').first().evaluate(
    (element) => Number.parseFloat(getComputedStyle(element).transitionDuration),
  );
  expect(transitionDuration).toBeLessThanOrEqual(0.001);
});

test('@qec uses a focused inspector drawer at laptop width', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-laptop', 'Laptop drawer acceptance is viewport-specific.');
  const workbench = await openWorkbench(page);
  await page.getByRole('combobox', { name: 'Active QEC Study' }).selectOption('surface-memory');
  const inspector = page.getByRole('complementary', { name: 'Research inspector' });
  await expect(inspector).toHaveCSS('position', 'absolute');

  const close = inspector.getByRole('button', { name: 'Close research inspector' });
  await close.click();
  const show = page.getByRole('button', { name: 'Show research inspector' });
  await expect(show).toBeFocused();
  await show.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Research inspector' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(show).toBeFocused();
  await show.press('Enter');

  const study = page.getByRole('combobox', { name: 'Active QEC Study' });
  await study.selectOption('surface-memory');
  await expect(study).toHaveValue('surface-memory');
  await expect.poll(() => workbench.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page).toHaveScreenshot('qec-workbench-build-1024.png', { fullPage: true });
});

test('@qec creates and restores an Analyze Study across immediate navigation', async ({ page }) => {
  await openWorkbench(page);
  const createStudy = page.getByRole('region', { name: 'Create Study' });
  await createStudy.getByLabel('Study name').fill('Decoder Sweep');
  await createStudy.getByLabel('Research question').fill('Which decoder is stable?');
  await createStudy.getByRole('combobox', { name: 'Workspace preset' }).selectOption('analyze');
  const create = createStudy.getByRole('button', { name: 'Create Study' });
  await expect(create).toHaveCSS('background-color', 'rgb(14, 116, 144)');
  await expect(create).toHaveCSS('color', 'rgb(255, 255, 255)');
  await create.click();

  const picker = page.getByRole('combobox', { name: 'Active QEC Study' });
  await expect(picker).toHaveValue('decoder-sweep');
  await expect(page.getByRole('button', { name: 'Analyze' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Observe' }).click();

  await page.getByRole('button', { name: 'Explorer' }).click();
  await page.getByRole('button', { name: 'QEC Workbench' }).click();

  await expect(picker).toHaveValue('decoder-sweep');
  await picker.selectOption('surface-memory');
  await expect(page.getByRole('button', { name: 'Build' })).toHaveAttribute('aria-pressed', 'true');
  await picker.selectOption('decoder-sweep');
  await expect(page.getByRole('button', { name: 'Observe' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'QEC Studies' }).getByRole('button', { name: /Decoder Sweep/ })).toBeVisible();
  await expect(page.locator('.qec-source-group__empty')).toHaveCSS('color', 'rgb(82, 97, 117)');
  await expect(page.locator('.qec-sources')).toHaveCSS('background-color', 'rgb(241, 245, 249)');
});
