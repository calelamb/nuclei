import { expect, test } from '@playwright/test';

const FIXTURE_URL = '/?e2eProject=qec-project&workspace=research&e2eDesktop=1';

test('@explorer a duplicate name never makes the project tree vanish', async ({ page }) => {
  await page.goto(FIXTURE_URL);
  const tree = page.getByRole('tree', { name: 'Project files' });
  await expect(tree.getByRole('treeitem', { name: /circuits/ })).toBeVisible();
  const before = await tree.getByRole('treeitem').count();

  await page.getByRole('button', { name: 'New file, circuit or folder' }).click();
  await page.getByRole('menuitem', { name: /New folder/ }).click();
  const input = page.getByRole('textbox', { name: /name/i });
  await input.fill('circuits');
  await input.press('Enter');

  await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(tree.getByRole('treeitem')).toHaveCount(before);

  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(tree.getByRole('treeitem')).toHaveCount(before);
});
