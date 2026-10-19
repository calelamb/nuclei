import { expect, test, type Page } from '@playwright/test';

/**
 * Needs the Pyodide web build: `npm run build:web && npm run preview:web -- --port 11711`,
 * then NUCLEI_WEB_URL=http://127.0.0.1:11711/try/ npx playwright test web-shell-r10.
 */
const WEB_URL = process.env.NUCLEI_WEB_URL;

async function openResearch(page: Page) {
  await page.goto(WEB_URL as string);
  await page.getByText('Research workspace').first().click();
  const skip = page.getByText('Skip', { exact: true });
  if (await skip.count()) await skip.first().click();
  await expect(page.getByText(/Python ready/).first()).toBeVisible({ timeout: 90_000 });
}

test('@web twenty Runs leave the console free of WebGL context warnings (IR10-01)', async ({ page }) => {
  test.skip(!WEB_URL, 'set NUCLEI_WEB_URL to the web preview to run this check');
  test.setTimeout(180_000);
  const warnings: string[] = [];
  page.on('console', (m) => { if (/too many active webgl contexts/i.test(m.text())) warnings.push(m.text()); });
  await openResearch(page);
  await page.evaluate(() => {
    const w = window as unknown as { __runsStarted: number };
    w.__runsStarted = 0;
    let running = document.body.innerText.includes('Running…');
    new MutationObserver(() => {
      const now = document.body.innerText.includes('Running…');
      if (now && !running) w.__runsStarted += 1;
      running = now;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.locator('.monaco-editor').first().click();
  for (let run = 1; run <= 20; run += 1) {
    await page.keyboard.press('ControlOrMeta+Enter');
    // 'Running…' appears once per Run (the terminal is a canvas, so count it in the DOM): wait for run N to start
    // and finish, so Runs never coalesce into fewer mounts than the loop claims.
    await page.waitForFunction((n) => (window as unknown as { __runsStarted: number }).__runsStarted >= n, run, { timeout: 30_000 });
    await expect(page.getByText(/Done · /).first()).toBeVisible({ timeout: 30_000 });
    await page.waitForFunction(() => !document.body.innerText.includes('Running…'), undefined, { timeout: 30_000 });
  }
  expect(warnings).toEqual([]);
});

test('@web dialog scrims keep their backdrop blur in the production build (research-r-14)', async ({ page }) => {
  test.skip(!WEB_URL, 'set NUCLEI_WEB_URL to the web preview to run this check');
  await openResearch(page);
  await page.getByRole('button', { name: /launch on hardware/i }).first().click();
  const scrim = page.locator('.nuclei-dialog-scrim').first();
  await expect(scrim).toBeVisible();
  const filter = await scrim.evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(filter).not.toBe('none');
  expect(filter).toContain('blur');
});

test('@web a Python error reads like the file, with no "Error:" glue or <string> (research-r-15)', async ({ page }) => {
  test.skip(!WEB_URL, 'set NUCLEI_WEB_URL to the web preview to run this check');
  test.setTimeout(150_000);
  await openResearch(page);
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.hh(0)\n');
  await page.keyboard.press('ControlOrMeta+Enter');
  const terminal = page.getByText(/Traceback \(most recent call last\):/).first();
  await expect(terminal).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('<string>')).toHaveCount(0);
  await expect(page.getByText(/^Error: Traceback/)).toHaveCount(0);
});
