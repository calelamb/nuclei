import { expect, test } from '@playwright/test';

const BASE = process.env.NUCLEI_DEV_URL ?? '/';
const MARKER = 'qc.h(0)  # my half-written work';

test('a half-written exercise survives Glossary and back, then Reset restores the starter', async ({ page }) => {
  await page.goto(BASE);
  await page.getByText('Learn quantum computing').first().click();
  await page.getByText('I know some quantum').first().click();
  await page.getByText('Quantum Computing Fundamentals').first().click();
  await page.getByRole('button', { name: /Your First Quantum Gate/ }).first().click();

  const exercise = page.locator('.exercise').first();
  await exercise.scrollIntoViewIfNeeded();
  await exercise.locator('.monaco-editor').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(MARKER);
  await page.waitForTimeout(600);

  await page.getByRole('button', { name: /Glossary/ }).first().click();
  await page.getByRole('button', { name: /Back to lesson/ }).first().click();

  await expect(page.locator('.exercise').first().locator('.view-lines')).toContainText('my half-written work');

  await page.locator('.exercise').getByRole('button', { name: /^Reset/ }).first().click();
  await page.locator('.exercise').getByRole('button', { name: /^Discard/ }).first().click();
  await expect(page.locator('.exercise').first().locator('.view-lines')).not.toContainText('my half-written work');
  await expect(page.locator('.exercise').getByRole('button', { name: /^Reset/ }).first()).toBeDisabled();
});

test('outline jump and Glossary -> Back never scroll the document (html.scrollTop stays 0)', async ({ page }) => {
  await page.goto(BASE);
  await page.getByText('Learn quantum computing').first().click();
  await page.getByText('I know some quantum').first().click();
  await page.getByText('Quantum Computing Fundamentals').first().click();
  await page.getByRole('button', { name: /Your First Quantum Gate/ }).first().click();
  const rootScroll = () => page.evaluate(() => document.scrollingElement?.scrollTop ?? 0);

  await page.locator('.lnav__outline-item').last().click();
  await page.waitForTimeout(700);
  expect(await rootScroll()).toBe(0);

  await page.getByRole('button', { name: /Glossary/ }).first().click();
  await page.getByRole('button', { name: /Back to lesson/ }).first().click();
  await page.waitForTimeout(300);
  expect(await rootScroll()).toBe(0);
});
