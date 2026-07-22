import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchRealQecDataEngine } from './support/qecDataEngine';

const FIXTURE_URL = '/?e2eProject=qec-project&workspace=research&qecImport=1';
const SOURCE_HASH = '6f45baf5e9f4215ebabc0e5177c34abe7e2fd5489d2531e70a098924d824dfbc';

async function installQecDataStartBoundary(
  page: Page,
  endpoint: Readonly<{ url: string; token: string }>,
): Promise<void> {
  await page.addInitScript((engineEndpoint) => {
    Object.defineProperty(window, '__NUCLEI_E2E_QEC_INVOKE__', {
      configurable: true,
      value: async (command: string): Promise<unknown> => {
        return command === 'qec_data_start' ? engineEndpoint : null;
      },
    });
  }, endpoint);
}

async function openWorkbench(page: Page): Promise<void> {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto(FIXTURE_URL);
  await page.getByRole('button', { name: 'QEC Workbench' }).click();
  await expect(page.getByRole('region', { name: 'QEC Workbench' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Active QEC Study' }).selectOption('qec-data-import');
}

async function nextStage(page: Page, heading: string): Promise<void> {
  await page.getByRole('button', { name: 'Next stage' }).click();
  const stageHeading = page.getByRole('heading', { name: heading, level: 3 });
  await expect(stageHeading).toBeVisible();
  await expect(stageHeading).toBeFocused();
}

test('@qec imports a detector stream and restores the canonical session after reload', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'The import lifecycle is covered at the primary research viewport.');
  const engine = await launchRealQecDataEngine();
  try {
    await installQecDataStartBoundary(page, engine.endpoint);
    await openWorkbench(page);

    await page.getByRole('button', { name: 'Import minimal-dets' }).click();
    const wizard = page.getByRole('region', { name: 'Import captures/minimal.dets' });
    await expect(wizard).toBeVisible();
    await expect(wizard).toHaveCSS('background-color', 'rgb(247, 250, 254)');
    await expect(wizard.getByText(SOURCE_HASH)).toBeVisible();

    await nextStage(page, 'Adapter');
    await page.getByRole('radio', { name: /Stim-results adapter/ }).check();
    await nextStage(page, 'Mapping');
    await page.getByLabel('Detector width').fill('3');
    await page.getByLabel('Observable width').fill('1');
    await page.getByLabel('Mapping reviewed').check();

    await nextStage(page, 'Preview');
    await expect(page.getByText('Preview requires successful validation')).toBeVisible();
    await nextStage(page, 'Validation');
    await page.getByRole('button', { name: 'Validate mapping' }).click();
    await expect(page.getByText('Validation passed')).toBeVisible();
    await page.getByRole('button', { name: 'Previous stage' }).click();
    await page.getByRole('button', { name: 'Load bounded preview' }).click();
    await expect(page.getByRole('table', { name: 'Canonical batch summary' })).toContainText('syndromes');
    await nextStage(page, 'Validation');
    await nextStage(page, 'Destination');
    await page.getByLabel('Session ID').fill('minimal-capture');
    await nextStage(page, 'Import');
    await page.getByRole('button', { name: 'Import data' }).click();
    await expect(page.getByText('2 records written')).toBeVisible();

    const sessions = page.getByRole('list', { name: 'Canonical sessions' });
    await expect(sessions.getByRole('button', { name: /minimal-capture/i })).toContainText('stim-results:');
    await page.reload();
    await page.getByRole('button', { name: 'QEC Workbench' }).click();
    await page.getByRole('combobox', { name: 'Active QEC Study' }).selectOption('qec-data-import');
    const restored = page.getByRole('list', { name: 'Canonical sessions' }).getByRole('button', { name: /minimal-capture/i });
    await expect(restored).toBeVisible();
    await expect(restored).toContainText('hardware import');
    await expect(restored).toContainText('complete');

    const sessionRoot = join(engine.projectRoot, 'qec-data/sessions/minimal-capture');
    const manifestPath = join(sessionRoot, 'manifest.json');
    const journalPath = join(sessionRoot, 'journal.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      session_id: 'minimal-capture', kind: 'hardware_import', status: 'complete',
      adapter: { id: 'stim-results', version: '1' },
    });
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      generation: number;
      segments: Array<{ partitions: Array<{ path: string; rows: number }> }>;
    };
    expect(journal.generation).toBe(1);
    expect(journal.segments).toHaveLength(1);
    expect(journal.segments[0]?.partitions).toHaveLength(1);
    const partition = journal.segments[0]?.partitions[0];
    expect(partition?.rows).toBe(2);
    expect(existsSync(join(sessionRoot, partition?.path ?? 'missing'))).toBe(true);
    expect(readdirSync(sessionRoot, { recursive: true }).some((path) => String(path).endsWith('.pending'))).toBe(false);
  } finally {
    await engine.close();
  }
});
