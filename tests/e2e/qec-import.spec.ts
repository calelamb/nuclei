import { expect, test, type Page } from '@playwright/test';

const FIXTURE_URL = '/?e2eProject=qec-project&workspace=research&qecImport=1';
const SESSION_STORAGE_KEY = 'nuclei:e2e:qec-engine-sessions';
const SOURCE_HASH = '6f45baf5e9f4215ebabc0e5177c34abe7e2fd5489d2531e70a098924d824dfbc';
const SOURCE_BYTE_SIZE = 22;

async function installQecDataEngineMock(page: Page): Promise<void> {
  await page.addInitScript(({ sessionKey, sourceHash, sourceByteSize }) => {
    const nativeWebSocket = window.WebSocket;
    const emit = (target: EventTarget, value: unknown): void => {
      target.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
    };
    const storedSessions = (): readonly Record<string, unknown>[] => {
      try {
        const value = JSON.parse(localStorage.getItem(sessionKey) ?? '[]') as unknown;
        return Array.isArray(value) ? value as readonly Record<string, unknown>[] : [];
      } catch {
        return [];
      }
    };
    const canonicalSession = (sessionId: string, adapterId: string): Record<string, unknown> => ({
      schema_version: '1.0.0', session_id: sessionId, kind: 'hardware_import', status: 'complete',
      created_at: '2026-07-22T16:00:00Z',
      started_at: { value: '2026-07-22T16:00:00Z', status: 'measured' },
      completed_at: { value: '2026-07-22T16:00:01Z', status: 'measured' },
      adapter: { id: adapterId, version: '1' },
      references: {
        circuit: { value: null, status: 'unknown' },
        detector_error_model: { value: null, status: 'unknown' },
        topology: { value: null, status: 'unknown' },
        calibration: { value: null, status: 'unavailable' },
      },
      counts: {
        detectors: { value: 3, status: 'measured' }, observables: { value: 1, status: 'measured' },
        measurements: { value: null, status: 'unknown' }, logical_patches: { value: null, status: 'unknown' },
      },
      source_clock: { identity: { value: null, status: 'unavailable' }, description: 'No hardware clock in Stim detector samples.' },
      timebase: {
        domain: 'round', unit: { value: 'round', status: 'measured' },
        tick_period: { value: null, status: 'unavailable' }, description: 'Imported detector sample order.',
      },
      provenance_id: `provenance-${sessionId}`, segments: ['segment-0'],
    });
    const isTruthfulStimMapping = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return false;
      const mapping = value as { fields?: unknown; options?: unknown };
      const fields = mapping.fields as Record<string, unknown> | undefined;
      const options = mapping.options as Record<string, unknown> | undefined;
      return Boolean(fields && Object.keys(fields).length === 0 && options
        && options.output_kind === 'syndromes'
        && options.detector_count === 3
        && options.observable_count === 1
        && options.bit_order === 'lsb0');
    };

    class QecMockSocket extends EventTarget {
      readyState = 0;

      constructor() {
        super();
        setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event('open')); }, 0);
      }

      send(serialized: string): void {
        const frame = JSON.parse(serialized) as Record<string, unknown>;
        const requestId = String(frame.requestId ?? '');
        if (frame.type === 'authenticate') {
          setTimeout(() => emit(this, { type: 'authenticated' }), 0);
        } else if (frame.type === 'session_list') {
          const cursor = typeof frame.cursor === 'string' ? frame.cursor : '';
          const limit = Number(frame.limit);
          const remaining = [...storedSessions()].sort((left, right) => String(left.session_id).localeCompare(String(right.session_id)))
            .filter((session) => String(session.session_id) > cursor);
          const sessions = remaining.slice(0, limit);
          const nextCursor = remaining.length > limit ? String(sessions.at(-1)?.session_id) : null;
          setTimeout(() => emit(this, { type: 'session_list_result', requestId, sessions, nextCursor }), 0);
        } else if (frame.type === 'import_probe') {
          setTimeout(() => emit(this, {
            type: 'import_probe_result', requestId, sourcePolicy: 'copy', sourceByteSize,
            results: [{
              adapterId: 'stim-results', adapterVersion: '1', supported: true,
              sourceKind: 'stim-dets', confidence: 1, sourceSha256: sourceHash,
              details: { format: 'Stim detection events', detector_count: 3, observable_count: 1 },
            }],
          }), 0);
        } else if (frame.type === 'import_validate') {
          if (frame.adapterId !== 'stim-results' || !isTruthfulStimMapping(frame.mapping)) {
            setTimeout(() => emit(this, {
              type: 'import_validation_result', requestId, valid: false,
              issues: [{ code: 'invalid_mapping', severity: 'error', field: 'mapping', message: 'Stim mapping must use native fields and explicit widths.' }],
              sourceSha256: sourceHash, provenanceId: null,
              sourceByteSize, sourcePolicy: 'copy',
            }), 0);
            return;
          }
          setTimeout(() => emit(this, {
            type: 'import_validation_result', requestId, valid: true, issues: [],
            sourceSha256: sourceHash, provenanceId: 'provenance-minimal-capture',
            sourceByteSize, sourcePolicy: 'copy',
          }), 0);
        } else if (frame.type === 'import_preview') {
          setTimeout(() => emit(this, {
            type: 'import_preview_result', requestId, truncated: false, totalRecords: 2,
            sourceSha256: sourceHash, provenanceId: 'provenance-minimal-capture',
            batches: [{
              recordKind: 'syndromes', recordCount: 2, sequenceStart: 0,
              sequenceEnd: 2, segmentId: 'segment-0',
            }],
          }), 0);
        } else if (frame.type === 'import_start') {
          const session = canonicalSession(String(frame.sessionId), String(frame.adapterId));
          const next = [...storedSessions().filter((item) => item.session_id !== session.session_id), session];
          localStorage.setItem(sessionKey, JSON.stringify(next));
          setTimeout(() => emit(this, {
            type: 'job_started', requestId, jobId: requestId, jobKind: 'import', sourcePolicy: 'copy',
          }), 0);
          setTimeout(() => emit(this, {
            type: 'job_complete', requestId, jobId: requestId,
            recordsWritten: 2, partitionsWritten: 1, sourcePolicy: 'copy',
          }), 10);
        }
      }

      close(): void {
        this.readyState = 3;
        this.dispatchEvent(new Event('close'));
      }
    }

    const socketProxy = new Proxy(nativeWebSocket, {
      construct(target, args) {
        return String(args[0]) === 'ws://127.0.0.1:9743'
          ? new QecMockSocket()
          : Reflect.construct(target, args);
      },
    });
    Object.defineProperty(window, 'WebSocket', { configurable: true, value: socketProxy });
    Object.defineProperty(window, '__NUCLEI_E2E_QEC_INVOKE__', {
      configurable: true,
      value: async (command: string): Promise<unknown> => {
        return command === 'qec_data_start'
          ? { url: 'ws://127.0.0.1:9743', token: 'e2e-token' }
          : null;
      },
    });
  }, { sessionKey: SESSION_STORAGE_KEY, sourceHash: SOURCE_HASH, sourceByteSize: SOURCE_BYTE_SIZE });
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
  await installQecDataEngineMock(page);
  await openWorkbench(page);

  await page.getByRole('button', { name: 'Import minimal-dets' }).click();
  const wizard = page.getByRole('region', { name: 'Import captures/minimal.dets' });
  await expect(wizard).toBeVisible();
  await expect(wizard).toHaveCSS('background-color', 'rgb(247, 250, 254)');
  await expect(wizard.getByText(SOURCE_HASH)).toBeVisible();

  await nextStage(page, 'Adapter');
  await page.getByRole('radio', { name: /Stim-results adapter/ }).check();
  await nextStage(page, 'Mapping');
  await page.getByLabel('Record class').selectOption('syndromes');
  await page.getByLabel('Detector width').fill('3');
  await page.getByLabel('Observable width').fill('1');
  await page.getByLabel('Bit order').selectOption('lsb0');
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
  await expect(sessions.getByRole('button', { name: /minimal-capture/i })).toContainText('provenance-minimal-capture');
  await page.reload();
  await page.getByRole('button', { name: 'QEC Workbench' }).click();
  await page.getByRole('combobox', { name: 'Active QEC Study' }).selectOption('qec-data-import');
  const restored = page.getByRole('list', { name: 'Canonical sessions' }).getByRole('button', { name: /minimal-capture/i });
  await expect(restored).toBeVisible();
  await expect(restored).toContainText('hardware import');
  await expect(restored).toContainText('complete');
});
