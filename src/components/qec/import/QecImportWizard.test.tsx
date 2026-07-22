// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

afterEach(cleanup);

function goNext(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Next stage' }));
}

describe('<QecImportWizard />', () => {
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
});
