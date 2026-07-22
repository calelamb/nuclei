// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useQecJobStore } from '../../../stores/qecJobStore';
import type { QecImportClient } from './QecImportWizard';
import { QecImportWizard } from './QecImportWizard';

function client(): QecImportClient {
  return {
    probe: vi.fn(async () => ({
      type: 'import_probe_result', requestId: 'probe-1', sourcePolicy: 'copy' as const,
      sourceByteSize: 2048,
      results: [{
        adapterId: 'tabular', adapterVersion: '1', supported: true, sourceKind: 'parquet',
        confidence: 0.8, sourceSha256: 'a'.repeat(64), details: {},
      }],
    })),
    validate: vi.fn(async () => ({
      type: 'import_validation_result', requestId: 'validate-1', valid: true, issues: [],
      sourceSha256: 'a'.repeat(64), provenanceId: 'provenance-1', sourceByteSize: 2048,
      sourcePolicy: 'copy' as const,
    })),
    preview: vi.fn(async () => ({
      type: 'import_preview_result', requestId: 'preview-1', truncated: true, totalRecords: null,
      sourceSha256: 'a'.repeat(64), provenanceId: 'provenance-1',
      batches: [{ recordKind: 'syndrome_batches', recordCount: 25, sequenceStart: 0, sequenceEnd: 25, segmentId: 'segment-1' }],
    })),
    startImport: vi.fn(async (_input, onEvent) => {
      onEvent?.({ type: 'job_started', requestId: 'import-1', jobId: 'import-1', jobKind: 'import', sourcePolicy: 'copy' });
      return { type: 'job_complete', requestId: 'import-1', jobId: 'import-1', recordsWritten: 25, partitionsWritten: 1, sourcePolicy: 'copy' };
    }),
    cancel: vi.fn(async () => true),
  };
}

function nativeClient(adapterId: 'stim-results' | 'sinter-csv'): QecImportClient {
  const fake = client();
  vi.mocked(fake.probe).mockResolvedValue({
    type: 'import_probe_result', requestId: 'probe-native', sourcePolicy: 'copy', sourceByteSize: 2048,
    results: [{
      adapterId, adapterVersion: '1', supported: true,
      sourceKind: adapterId === 'stim-results' ? 'stim-dets' : 'sinter-csv',
      confidence: 1, sourceSha256: 'a'.repeat(64), details: {},
    }],
  });
  return fake;
}

afterEach(() => {
  cleanup();
  useQecJobStore.getState().reset();
});

function goNext(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Next stage' }));
}

async function reachMapping(): Promise<void> {
  await screen.findByText('2.00 KiB');
  goNext();
  fireEvent.click(screen.getByRole('radio', { name: /Tabular/ }));
  goNext();
  fireEvent.click(screen.getByRole('button', { name: 'Add field mapping' }));
  fireEvent.change(screen.getByLabelText('Canonical field 1'), { target: { value: 'sequence' } });
  fireEvent.change(screen.getByLabelText('Source field 1'), { target: { value: 'shot_id' } });
  fireEvent.click(screen.getByLabelText('Mapping reviewed'));
}

async function reachImportStage(): Promise<void> {
  await reachMapping();
  goNext();
  goNext();
  fireEvent.click(screen.getByRole('button', { name: 'Validate mapping' }));
  await screen.findByText('Validation passed');
  goNext();
  fireEvent.change(screen.getByLabelText('Session ID'), { target: { value: 'capture-session' } });
  goNext();
}

describe('<QecImportWizard />', () => {
  it('shows only actual native Stim width requirements', async () => {
    render(<QecImportWizard source="captures/capture.dets" client={nativeClient('stim-results')} />);
    await screen.findByText('2.00 KiB');
    goNext();
    fireEvent.click(screen.getByRole('radio', { name: /Stim-results/ }));
    goNext();

    expect(screen.queryByRole('button', { name: 'Add field mapping' })).toBeNull();
    expect(screen.getByLabelText('Detector width')).toBeTruthy();
    expect(screen.getByLabelText('Observable width')).toBeTruthy();
    expect(screen.queryByLabelText('Record class')).toBeNull();
    expect(screen.queryByLabelText('Timestamp unit')).toBeNull();
    expect(screen.queryByLabelText('Bit order')).toBeNull();

    fireEvent.click(screen.getByLabelText('Mapping reviewed'));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next stage' }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Detector width'), { target: { value: '3' } });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next stage' }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Observable width'), { target: { value: '0' } });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next stage' }).disabled).toBe(false);
  });

  it('presents native sinter columns without invented mapping options', async () => {
    render(<QecImportWizard source="campaign/stats.csv" client={nativeClient('sinter-csv')} />);
    await screen.findByText('2.00 KiB');
    goNext();
    fireEvent.click(screen.getByRole('radio', { name: /Sinter-csv/ }));
    goNext();

    expect(screen.getByText(/sinter defines campaign-point fields/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add field mapping' })).toBeNull();
    expect(screen.queryByRole('group', { name: /Scientific meaning/i })).toBeNull();
    fireEvent.click(screen.getByLabelText('Mapping reviewed'));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next stage' }).disabled).toBe(false);
  });

  it('keeps Import disabled with an adjacent reason until explicit mapping validates', async () => {
    const fake = client();
    render(<QecImportWizard source="captures/capture.parquet" client={fake} />);

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Import data' }).disabled).toBe(true);
    expect(screen.getByText(/Import unavailable:/).textContent).toMatch(/probe/i);
    await screen.findByText('2.00 KiB');
    expect(screen.getByText('Copy-only import')).toBeTruthy();
    expect(screen.getByText('a'.repeat(64))).toBeTruthy();

    goNext();
    fireEvent.click(screen.getByRole('radio', { name: /Tabular/ }));
    goNext();
    fireEvent.click(screen.getByRole('button', { name: 'Add field mapping' }));
    fireEvent.change(screen.getByLabelText('Canonical field 1'), { target: { value: 'sequence' } });
    fireEvent.change(screen.getByLabelText('Source field 1'), { target: { value: 'shot_id' } });
    fireEvent.click(screen.getByLabelText('Mapping reviewed'));
    expect(screen.getByText('1 mapped field')).toBeTruthy();

    goNext();
    expect(screen.getByText(/Preview requires successful validation/)).toBeTruthy();
    goNext();
    fireEvent.click(screen.getByRole('button', { name: 'Validate mapping' }));
    await screen.findByText('Validation passed');
    expect(screen.getByText('provenance-1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Previous stage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load bounded preview' }));
    await screen.findByText('Preview truncated');
    expect(screen.getByText('syndrome_batches')).toBeTruthy();
    goNext();
    goNext();
    fireEvent.change(screen.getByLabelText('Session ID'), { target: { value: 'capture-session' } });
    expect(screen.getByLabelText<HTMLInputElement>('Session ID').hasAttribute('maxlength')).toBe(false);
    goNext();

    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Import data' }).disabled).toBe(false);
    expect(screen.queryByText(/Import unavailable:/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Import data' }));
    await screen.findByText('25 records written');
    expect(screen.getByText(/Original preserved/)).toBeTruthy();
  });

  it('reports probe failures and exposes a labeled close action', async () => {
    const fake = client();
    vi.mocked(fake.probe).mockRejectedValue(new Error('probe unavailable'));
    const close = vi.fn();
    render(<QecImportWizard source="captures/broken.parquet" client={fake} onClose={close} />);

    expect((await screen.findByRole('alert')).textContent).toContain('probe unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Close import wizard' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('surfaces validation warnings and quarantine as semantic text, not color alone', async () => {
    const fake = client();
    vi.mocked(fake.validate).mockResolvedValue({
      type: 'import_validation_result', requestId: 'validate-1', valid: false,
      sourceSha256: 'a'.repeat(64), provenanceId: 'quarantine-1', sourceByteSize: 2048,
      sourcePolicy: 'copy', issues: [
        { code: 'width_required', message: 'Detector width must be explicit.', severity: 'error', field: 'detector_count' },
        { code: 'rows_preserved', message: '18 source rows remain preserved.', severity: 'warning', field: null },
      ],
    });
    render(<QecImportWizard source="captures/capture.parquet" client={fake} />);
    await screen.findByText('2.00 KiB');
    goNext();
    fireEvent.click(screen.getByRole('radio', { name: /Tabular/ }));
    goNext();
    fireEvent.click(screen.getByRole('button', { name: 'Add field mapping' }));
    fireEvent.change(screen.getByLabelText('Canonical field 1'), { target: { value: 'sequence' } });
    fireEvent.change(screen.getByLabelText('Source field 1'), { target: { value: 'shot_id' } });
    fireEvent.click(screen.getByLabelText('Mapping reviewed'));
    goNext();
    goNext();
    fireEvent.click(screen.getByRole('button', { name: 'Validate mapping' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Quarantine required/);
    expect(alert.textContent).toMatch(/Detector width must be explicit/);
    expect(screen.getByText(/18 source rows remain preserved/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Import data' }).disabled).toBe(true);
    await waitFor(() => expect(document.activeElement?.textContent).toMatch(/Detector width/));
  });

  it('ignores stale validation completion after the mapping is invalidated', async () => {
    const fake = client();
    let finish: ((value: Awaited<ReturnType<QecImportClient['validate']>>) => void) | undefined;
    vi.mocked(fake.validate).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<QecImportWizard source="captures/capture.parquet" client={fake} />);
    await reachMapping();
    goNext();
    goNext();
    fireEvent.click(screen.getByRole('button', { name: 'Validate mapping' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous stage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous stage' }));
    fireEvent.change(screen.getByLabelText('Source field 1'), { target: { value: 'new_shot_id' } });
    finish?.({
      type: 'import_validation_result', requestId: 'late', valid: true, issues: [],
      sourceSha256: 'a'.repeat(64), provenanceId: 'late', sourceByteSize: 2048, sourcePolicy: 'copy',
    });
    await waitFor(() => expect(fake.validate).toHaveBeenCalledOnce());
    goNext();
    expect(screen.getByText(/Preview requires successful validation/)).toBeTruthy();
  });

  it('ignores a stale preview after a different mapping is validated', async () => {
    const fake = client();
    let finishPreview: ((value: Awaited<ReturnType<QecImportClient['preview']>>) => void) | undefined;
    vi.mocked(fake.preview).mockImplementation(() => new Promise((resolve) => { finishPreview = resolve; }));
    render(<QecImportWizard source="captures/capture.parquet" client={fake} />);
    await reachMapping();
    goNext();
    goNext();
    fireEvent.click(screen.getByRole('button', { name: 'Validate mapping' }));
    await screen.findByText('Validation passed');
    fireEvent.click(screen.getByRole('button', { name: 'Previous stage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load bounded preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous stage' }));
    fireEvent.change(screen.getByLabelText('Source field 1'), { target: { value: 'new_shot_id' } });
    goNext();
    goNext();
    fireEvent.click(screen.getByRole('button', { name: 'Validate mapping' }));
    await screen.findByText('Validation passed');
    fireEvent.click(screen.getByRole('button', { name: 'Previous stage' }));
    finishPreview?.({
      type: 'import_preview_result', requestId: 'stale', truncated: true, totalRecords: 99,
      sourceSha256: 'a'.repeat(64), provenanceId: 'old',
      batches: [{ recordKind: 'syndromes', recordCount: 99, sequenceStart: 0, sequenceEnd: 99, segmentId: 'old' }],
    });
    await waitFor(() => expect(fake.preview).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Load bounded preview' })).toBeTruthy();
    expect(screen.queryByText('99')).toBeNull();
  });

  it('resets the complete workflow when the source changes', async () => {
    const fake = client();
    const view = render(<QecImportWizard source="captures/first.parquet" client={fake} />);
    await reachMapping();
    goNext();
    goNext();
    fireEvent.click(screen.getByRole('button', { name: 'Validate mapping' }));
    await screen.findByText('Validation passed');
    view.rerender(<QecImportWizard source="captures/second.parquet" client={fake} />);
    expect(await screen.findByRole('heading', { name: 'Source' })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Import data' }).disabled).toBe(true);
  });

  it('focuses stage headings and the first quarantine correction action', async () => {
    const fake = client();
    vi.mocked(fake.validate).mockResolvedValue({
      type: 'import_validation_result', requestId: 'invalid', valid: false,
      sourceSha256: 'a'.repeat(64), provenanceId: 'q', sourceByteSize: 2048, sourcePolicy: 'copy',
      issues: [{ code: 'width', message: 'Detector width required.', severity: 'error', field: 'detector_count' }],
    });
    render(<QecImportWizard source="captures/capture.parquet" client={fake} />);
    await reachMapping();
    fireEvent.click(screen.getByRole('button', { name: 'Previous stage' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Adapter' })));
    goNext();
    goNext();
    goNext();
    fireEvent.click(screen.getByRole('button', { name: 'Validate mapping' }));
    const correction = await screen.findByRole('button', { name: /Review detector_count mapping/ });
    await waitFor(() => expect(document.activeElement).toBe(correction));
  });

  it('preserves probe adapter reasons for scientific review', async () => {
    const fake = client();
    vi.mocked(fake.probe).mockResolvedValue({
      type: 'import_probe_result', requestId: 'probe-1', sourcePolicy: 'copy', sourceByteSize: 2048,
      results: [{ adapterId: 'tabular', adapterVersion: '1', supported: true, sourceKind: 'parquet', confidence: 0.8, sourceSha256: 'a'.repeat(64), details: { delimiter: 'comma', reason: 'Sinter columns detected' } }],
    });
    render(<QecImportWizard source="captures/capture.parquet" client={fake} />);
    await screen.findByText('2.00 KiB');
    goNext();
    expect(screen.getByText(/delimiter: comma/)).toBeTruthy();
    expect(screen.getByText(/Sinter columns detected/)).toBeTruthy();
  });

  it('cancels a running import from the wizard and renders a terminal status', async () => {
    const fake = client();
    let rejectImport: ((error: unknown) => void) | undefined;
    vi.mocked(fake.startImport).mockImplementation((_input, onEvent) => {
      onEvent?.({
        type: 'job_started', requestId: 'import-cancel', jobId: 'import-cancel',
        jobKind: 'import', sourcePolicy: 'copy',
      });
      return new Promise((_resolve, reject) => { rejectImport = reject; });
    });
    vi.mocked(fake.cancel).mockImplementation(async () => {
      rejectImport?.(Object.assign(new Error('Import cancelled.'), { code: 'request_cancelled' }));
      return true;
    });
    const view = render(<QecImportWizard source="captures/capture.parquet" client={fake} />);
    await reachImportStage();
    fireEvent.click(screen.getByRole('button', { name: 'Import data' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel import import-cancel' }));

    await waitFor(() => expect(fake.cancel).toHaveBeenCalledWith('import', 'import-cancel'));
    expect((await screen.findByRole('status')).textContent).toMatch(/Import cancelled/);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(view.container.querySelector('.lucide-loader-circle')).toBeNull();
  });

  it.each([
    ['cancelled', 'Import cancelled', undefined],
    ['failed', 'Import failed', 'Canonical write failed.'],
  ] as const)('renders %s jobs as terminal rather than progress', async (status, label, error) => {
    const fake = client();
    const view = render(<QecImportWizard source="captures/capture.parquet" client={fake} />);
    await reachImportStage();
    useQecJobStore.setState({
      jobs: {
        terminal: {
          id: 'terminal', kind: 'import', status, message: label, error,
          source: 'captures/capture.parquet', adapterId: 'tabular', sessionId: 'capture-session',
          sessionKind: 'hardware_import', sourceHash: 'a'.repeat(64),
          provenanceId: 'provenance-1', sourceByteSize: 2048,
        },
      },
    });

    const terminal = await screen.findByText(label);
    expect(terminal).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(view.container.querySelector('.lucide-loader-circle')).toBeNull();
    if (status === 'failed') expect(screen.getByRole('alert').textContent).toContain('Canonical write failed.');
  });
});
