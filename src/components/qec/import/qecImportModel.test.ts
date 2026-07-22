import { describe, expect, it } from 'vitest';

import { buildMapping, completeRows, formatBytes, sessionIdIssue, stageDescription, supportedAdapters } from './qecImportModel';

describe('qecImportModel', () => {
  it('formats bounded source sizes across units', () => {
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(2048)).toBe('2.00 KiB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.00 MiB');
  });

  it('sorts only supported adapters by confidence without mutating the probe', () => {
    const results = [
      { adapterId: 'low', adapterVersion: '1', supported: true, sourceKind: 'csv', confidence: 0.3, sourceSha256: null, details: {} },
      { adapterId: 'no', adapterVersion: '1', supported: false, sourceKind: null, confidence: 1, sourceSha256: null, details: {} },
      { adapterId: 'high', adapterVersion: '1', supported: true, sourceKind: 'csv', confidence: 0.9, sourceSha256: null, details: {} },
    ] as const;
    const probe = { type: 'import_probe_result', requestId: 'p', sourcePolicy: 'copy', sourceByteSize: 1, results } as const;
    expect(supportedAdapters(probe).map((adapter) => adapter.adapterId)).toEqual(['high', 'low']);
    expect(results.map((adapter) => adapter.adapterId)).toEqual(['low', 'no', 'high']);
    expect(supportedAdapters(null)).toEqual([]);
  });

  it('keeps only complete mapping rows and explicit scientific options', () => {
    const rows = [
      { id: 1, canonical: ' sequence ', source: ' shot_id ' },
      { id: 2, canonical: '', source: 'ignored' },
    ];
    expect(completeRows(rows)).toHaveLength(1);
    expect(buildMapping(rows, {
      outputKind: 'syndromes', detectorCount: '8', observableCount: '', timestampUnit: 'ns',
    })).toEqual({
      fields: { sequence: 'shot_id' },
      options: { output_kind: 'syndromes', timestamp_unit: 'ns', detector_count: 8 },
    });
  });

  it('describes every fixed stage', () => {
    for (const stage of ['Source', 'Adapter', 'Mapping', 'Preview', 'Validation', 'Destination', 'Import'] as const) {
      expect(stageDescription(stage).length).toBeGreaterThan(20);
    }
  });

  it.each(['.', '..', 'bad/name', 'bad:name', `bad${String.fromCharCode(1)}name`, 'x'.repeat(257)])(
    'rejects backend-invalid session id %j',
    (value) => expect(sessionIdIssue(value)).not.toBeNull(),
  );

  it('accepts a bounded portable session id', () => {
    expect(sessionIdIssue('capture-2026-07-22')).toBeNull();
    expect(sessionIdIssue('🧪'.repeat(256))).toBeNull();
    expect(sessionIdIssue('🧪'.repeat(257))).toBe('session ID must be 256 characters or fewer');
  });
});
