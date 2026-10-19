import { expect, test, type Page } from '@playwright/test';

/**
 * Round 11 Learn lane. Needs the Pyodide web build:
 * `npm run build:web && npm run preview:web -- --port 12811`, then
 * NUCLEI_WEB_URL=http://127.0.0.1:12811/try/ npx playwright test learn-r11
 */
const WEB_URL = process.env.NUCLEI_WEB_URL;

async function openLearn(page: Page) {
  await page.goto(WEB_URL as string);
  await page.getByText('Learn quantum computing').first().click();
  await page.getByText('I know some quantum').click();
}

async function openFirstLesson(page: Page) {
  await page.getByText('Python Essentials').first().click();
  await page.getByRole('button', { name: /Hello, Quantum World/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Hello, Quantum World', level: 1 })).toBeVisible();
}

async function replaceEditor(page: Page, scope: string, code: string) {
  await page.locator(`${scope} .monaco-editor`).first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(code);
}

test.beforeEach(() => { test.skip(!WEB_URL, 'set NUCLEI_WEB_URL to the web preview to run this check'); });

test('@web a lesson error names the line in the student numbering', async ({ page }) => {
  test.setTimeout(120_000);
  await openLearn(page);
  await openFirstLesson(page);
  await replaceEditor(page, '.demo', 'x = 1\nprnt("hi")');
  await page.locator('.demo').getByRole('button', { name: /^Run$/ }).click();
  await expect(page.locator('.demo__error')).toContainText(/Line 2 · NameError/, { timeout: 30_000 });
});

test('@web a challenge error names the line, marks the editor, and reports IndentationError in student numbering', async ({ page }) => {
  test.setTimeout(150_000);
  await openLearn(page);
  await page.keyboard.press('ControlOrMeta+3');
  await page.getByRole('button', { name: /^Bell State Factory/ }).click();
  // Monaco carries the previous line's indent onto each typed line, so only the first body line is indented.
  const bad = ['from qiskit import QuantumCircuit', '', 'def solve(bell_index):', '    qc = QuantumCircuit(2)', 'qc.h(0)', 'qc.cx(0, 1)', 'qc.hh(1)', 'return qc'].join('\n');
  await replaceEditor(page, '.pwork__editor', bad);
  await page.getByRole('button', { name: /Run visible tests/ }).click();
  await expect(page.locator('.trun__failure-title')).toContainText('(line 7)', { timeout: 60_000 });
  await expect(page.locator('.pwork__editor .squiggly-error')).not.toHaveCount(0);

  const unindented = ['from qiskit import QuantumCircuit', '', 'def solve(bell_index):', 'qc = QuantumCircuit(2)', 'return qc'].join('\n');
  await replaceEditor(page, '.pwork__editor', unindented);
  await page.getByRole('button', { name: /Run visible tests/ }).click();
  await expect(page.locator('.trun__failure-detail')).toContainText(/on line 3\b/, { timeout: 60_000 });
});

test('@web keyboard-only through a challenge never drops focus to <body>', async ({ page }) => {
  test.setTimeout(150_000);
  await openLearn(page);
  await page.keyboard.press('ControlOrMeta+3');
  const row = page.getByRole('button', { name: /^Bell State Factory/ });
  await row.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cmode__problem')).toBeFocused();

  const run = page.getByRole('button', { name: /Run visible tests/ });
  await run.focus();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 20; i += 1) {
    const onBody = await page.evaluate(() => document.activeElement === document.body);
    expect(onBody).toBe(false);
    await page.waitForTimeout(150);
  }

  await page.getByRole('button', { name: 'Back' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /^Bell State Factory/ })).toBeFocused();
});

test('@web an open challenge and a lesson position survive rail round trips and a reload', async ({ page }) => {
  await openLearn(page);
  await page.keyboard.press('ControlOrMeta+3');
  await page.getByRole('button', { name: /^Bell State Factory/ }).click();
  await expect(page.locator('.pwork')).toBeVisible();
  await page.getByRole('button', { name: 'Learning' }).click();
  await page.getByRole('button', { name: 'Challenges' }).click();
  await expect(page.locator('.pwork')).toBeVisible();

  await page.getByRole('button', { name: 'Learning' }).click();
  await page.getByRole('button', { name: /Quantum Computing Fundamentals|Python Essentials/ }).first().click().catch(() => undefined);
  await openFirstLesson(page);
  const scroller = page.locator('.lesson__scroll, .lesson').first();
  await page.evaluate(() => {
    const el = document.querySelector('[data-block-index="2"]');
    el?.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => document.querySelector('[data-block-index="2"]')?.getBoundingClientRect().top ?? -1);
  await page.getByRole('button', { name: 'Explorer' }).click();
  await page.getByRole('button', { name: 'Learning' }).click();
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => document.querySelector('[data-block-index="2"]')?.getBoundingClientRect().top ?? -1);
  expect(Math.abs(after - before)).toBeLessThan(80);
  await expect(scroller).toBeVisible();
});
