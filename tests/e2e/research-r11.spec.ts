import { expect, test } from '@playwright/test';

const FIXTURE_URL = '/?e2eProject=qec-project&workspace=research';

test('@qec the sources toggle keeps keyboard focus when the panel folds and unfolds (qec-r-83)', async ({ page }) => {
  await page.goto(FIXTURE_URL);
  await page.getByRole('button', { name: 'QEC Workbench' }).click();
  await expect(page.getByRole('region', { name: 'QEC Workbench' })).toBeVisible();

  const hide = page.getByRole('button', { name: 'Hide sources' });
  await hide.focus();
  await page.keyboard.press('Enter');
  const show = page.getByRole('button', { name: 'Show sources' });
  await expect(show).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Hide sources' })).toBeFocused();
});

test('@qec New study returns focus on Cancel and Escape, and lands on the created study (qec-r-83)', async ({ page }) => {
  await page.goto(FIXTURE_URL);
  await page.getByRole('button', { name: 'QEC Workbench' }).click();
  const newStudy = page.getByRole('button', { name: 'New study' });
  await expect(newStudy).toBeVisible();

  await newStudy.click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(newStudy).toBeFocused();

  await newStudy.click();
  await page.getByLabel('Study name').press('Escape');
  await expect(newStudy).toBeFocused();

  await newStudy.click();
  await page.getByLabel('Study name').fill('Focus check');
  await page.getByLabel('Research question').fill('Does focus survive?');
  await page.getByRole('button', { name: 'Create study' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Study created' })).toBeAttached();
  await expect(page.getByLabel('QEC Studies').getByRole('button', { name: /Focus check/ })).toBeFocused();
});
