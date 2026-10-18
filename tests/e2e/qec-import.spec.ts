import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchRealQecDataEngine } from './support/qecDataEngine';

const FIXTURE_URL = '/?e2eProject=qec-project&workspace=research&qecImport=1';
const SOURCE_HASH = '6f45baf5e9f4215ebabc0e5177c34abe7e2fd5489d2531e70a098924d824dfbc';
const ENGINE_RESULT_TIMEOUT_MS = 15_000;
const IMPORT_LIFECYCLE_TIMEOUT_MS = 60_000;

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
  test.setTimeout(IMPORT_LIFECYCLE_TIMEOUT_MS);
  test.skip(testInfo.project.name !== 'chromium', 'The import lifecycle is covered at the primary research viewport.');
  const engine = await launchRealQecDataEngine();
  try {
    await installQecDataStartBoundary(page, engine.endpoint);
    await openWorkbench(page);

    await page.getByRole('button', { name: 'Import minimal-dets' }).click();
    const wizard = page.getByRole('region', { name: 'Import captures/minimal.dets' });
    await expect(wizard).toBeVisible();
    await expect(wizard).toHaveCSS('background-color', 'rgb(241, 245, 249)');
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
    await expect(page.getByText('Validation passed')).toBeVisible({ timeout: ENGINE_RESULT_TIMEOUT_MS });
    await page.getByRole('button', { name: 'Previous stage' }).click();
    await page.getByRole('button', { name: 'Load bounded preview' }).click();
    await expect(page.getByRole('table', { name: 'Canonical batch summary' })).toContainText(
      'syndromes',
      { timeout: ENGINE_RESULT_TIMEOUT_MS },
    );
    await nextStage(page, 'Validation');
    await nextStage(page, 'Destination');
    await page.getByLabel('Session ID').fill('minimal-capture');
    await nextStage(page, 'Import');
    await page.getByRole('button', { name: 'Import data' }).click();
    await expect(page.getByText('2 records written')).toBeVisible({ timeout: ENGINE_RESULT_TIMEOUT_MS });

    const sessions = page.getByRole('list', { name: 'Canonical sessions' });
    await expect(sessions.getByRole('button', { name: /minimal-capture/i })).toContainText('stim-results:');
    await page.reload();
    await page.getByRole('button', { name: 'QEC Workbench' }).click();
    await page.getByRole('combobox', { name: 'Active QEC Study' }).selectOption('qec-data-import');
    const restored = page.getByRole('list', { name: 'Canonical sessions' }).getByRole('button', { name: /minimal-capture/i });
    await expect(restored).toBeVisible({ timeout: ENGINE_RESULT_TIMEOUT_MS });
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
      segments: ['segment-0001'],
    });
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      generation: number;
      segments: Array<{ segment_id: string; partitions: Array<{ path: string; rows: number }> }>;
    };
    expect(journal.generation).toBe(1);
    expect(journal.segments).toHaveLength(1);
    expect(manifest.segments).toEqual(journal.segments.map((segment) => segment.segment_id));
    expect(journal.segments[0]?.partitions).toHaveLength(1);
    const partition = journal.segments[0]?.partitions[0];
    expect(partition?.rows).toBe(2);
    expect(existsSync(join(sessionRoot, partition?.path ?? 'missing'))).toBe(true);
    expect(readdirSync(sessionRoot, { recursive: true }).some((path) => String(path).endsWith('.pending'))).toBe(false);
  } finally {
    await engine.close();
  }
});

/** A finished import's card in the Jobs tray: title row above its fields, never drawn over them. */
test('@qec a finished import job card keeps its title clear of its own fields', async ({ page }) => {
  await page.addInitScript(() => {
    class Stub {
      private readonly listeners = new Map<string, Array<(event: Event | MessageEvent<string>) => void>>();
      constructor() { queueMicrotask(() => this.emit('open', new Event('open'))); }
      addEventListener(type: string, listener: (event: Event | MessageEvent<string>) => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
      send(serialized: string): void {
        const frame = JSON.parse(serialized) as { type?: string; requestId?: string };
        if (frame.type === 'authenticate') queueMicrotask(() => this.message({ type: 'authenticated' }));
        else if (frame.type === 'session_list') queueMicrotask(() => this.message({ type: 'session_list_result', requestId: frame.requestId, sessions: [], nextCursor: null }));
      }
      close(): void { this.emit('close', new Event('close')); }
      private message(frame: unknown): void { this.emit('message', new MessageEvent('message', { data: JSON.stringify(frame) })); }
      private emit(type: string, event: Event | MessageEvent<string>): void { for (const l of this.listeners.get(type) ?? []) l(event); }
    }
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: Stub });
    Object.defineProperty(window, '__NUCLEI_E2E_QEC_INVOKE__', {
      configurable: true,
      value: async (command: string): Promise<unknown> => command === 'qec_data_start' ? { url: 'ws://127.0.0.1:9743', token: '0'.repeat(64) } : null,
    });
  });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1100, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/?e2eProject=qec-project&workspace=research');
    await page.getByRole('button', { name: 'QEC Workbench' }).click();
    // The tray scopes its jobs to the open project once it mounts; seed after that so the seed is kept.
    await expect(page.getByRole('region', { name: 'QEC jobs and streams' })).toContainText('No active jobs');
    await page.evaluate(async ({ hash }) => {
      const { useQecJobStore } = await import('/src/stores/qecJobStore.ts');
      const { useProjectStore } = await import('/src/stores/projectStore.ts');
      useQecJobStore.setState({
        jobs: {
          a: {
            id: 'f2c0b7d1-5b0e-4c36-9a3b-0d6a8d2e4b11', kind: 'import', status: 'complete', message: 'ok',
            source: 'circuits/repetition.stim', adapterId: 'stim-circuit', sessionId: '0b6c1f3e-aaaa-4bbb-cccc-1234567890ab',
            sourceByteSize: 8701, sourceHash: hash, provenanceId: 'prov-7788', projectRoot: useProjectStore.getState().projectRoot ?? undefined,
          },
        },
      });
    }, { hash: SOURCE_HASH });
    const toggle = page.getByRole('button', { name: /Expand jobs and streams/ });
    if (await toggle.count()) await toggle.click();
    const card = page.getByRole('list', { name: 'Durable QEC jobs' }).getByRole('listitem').first();
    await expect(card).toBeVisible();
    const header = await card.locator(':scope > div').first().boundingBox();
    const fields = await card.locator('dl').boundingBox();
    expect(header, 'title row is drawn').not.toBeNull();
    expect(fields, 'fields are drawn').not.toBeNull();
    expect(header!.width, `${viewport.width}: title row width`).toBeGreaterThan(100);
    expect(header!.y + header!.height, `${viewport.width}: title row ends above the fields`).toBeLessThanOrEqual(fields!.y + 0.5);
    await expect(card).toContainText('8.5 KB');
    await expect(card).not.toContainText(SOURCE_HASH);
  }
});
