import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  calibrationRecordSchema,
  decodeResultSchema,
  provenanceRecordSchema,
  QEC_TILE_MAX_BYTES,
  qecQueryResultSchema,
  qecTilePayloadSchema,
  qecQuerySpecSchema,
  qecSessionSchema,
  syndromeBatchSchema,
} from './qecData';

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(resolve('schemas/qec-data/v1/fixtures', `${name}.json`), 'utf8'),
  );
}

describe('canonical QEC data schemas', () => {
  it('validates the same session fixture as Python', () => {
    expect(qecSessionSchema.parse(fixture('minimal-session')).schema_version).toBe('1.0.0');
  });

  it('validates the same syndrome fixture as Python', () => {
    const batch = syndromeBatchSchema.parse(fixture('minimal-batch'));
    expect(batch.detector_events.encoding).toBe('base64');
  });

  it.each([
    ['minimal-decode-result', decodeResultSchema],
    ['minimal-calibration-record', calibrationRecordSchema],
    ['minimal-provenance', provenanceRecordSchema],
  ])('validates the shared %s fixture', (name, schema) => {
    expect(schema.parse(fixture(name))).toBeDefined();
  });

  it('rejects shared malformed packed-bit vectors and arithmetic mismatches', () => {
    const batch = fixture('minimal-batch') as Record<string, unknown>;
    const vectors = fixture('packed-bits-vectors') as {
      valid: ReadonlyArray<{ record_count: number; packed: unknown }>;
      invalid: ReadonlyArray<{ packed: unknown }>;
    };
    for (const vector of vectors.valid) {
      expect(() => syndromeBatchSchema.parse({
        ...batch,
        record_count: vector.record_count,
        sequence_end: vector.record_count,
        detector_events: vector.packed,
        shot_range: {
          value: { start: 0, end: vector.record_count },
          status: 'measured',
        },
        observables: { value: null, status: 'absent' },
      })).not.toThrow();
    }
    for (const vector of vectors.invalid) {
      expect(() => syndromeBatchSchema.parse({ ...batch, detector_events: vector.packed })).toThrow();
    }
    expect(() => syndromeBatchSchema.parse({
      ...batch,
      sequence_start: 5,
      sequence_end: 2,
      record_count: 7,
    })).toThrow();
    expect(() => syndromeBatchSchema.parse({
      ...batch,
      sequence_start: 0,
      sequence_end: 9,
      record_count: 1,
    })).toThrow();
  });

  it('enforces data quality and lifecycle matrices', () => {
    const batch = fixture('minimal-batch') as Record<string, unknown>;
    expect(() => syndromeBatchSchema.parse({ ...batch, data_quality: [] })).toThrow();
    expect(() => syndromeBatchSchema.parse({ ...batch, data_quality: ['complete', 'partial'] })).toThrow();
    const decode = fixture('minimal-decode-result') as Record<string, unknown>;
    expect(() => decodeResultSchema.parse({ ...decode, status: 'error', error: null })).toThrow();
    expect(() => decodeResultSchema.parse({
      ...decode,
      error: { code: 'unexpected', message: 'not allowed on success' },
    })).toThrow();
  });

  it('keeps safe counts, calibration intervals, and provenance strings in parity', () => {
    const session = fixture('minimal-session') as Record<string, unknown>;
    const counts = session.counts as Record<string, unknown>;
    expect(() => qecSessionSchema.parse({
      ...session,
      counts: {
        ...counts,
        detectors: { value: Number.MAX_SAFE_INTEGER + 1, status: 'measured' },
      },
    })).toThrow();
    const calibration = fixture('minimal-calibration-record') as Record<string, unknown>;
    expect(() => calibrationRecordSchema.parse({
      ...calibration,
      effective_interval: {
        start: '2026-07-22T00:00:00Z',
        end: '2026-07-21T00:00:00Z',
      },
    })).toThrow();
    const provenance = fixture('minimal-provenance') as Record<string, unknown>;
    expect(() => provenanceRecordSchema.parse({
      ...provenance,
      mapping_decisions: [{ field: 'field', decision: '', reason: 'why' }],
    })).toThrow();
    expect(() => provenanceRecordSchema.parse({
      ...provenance,
      revision_references: [{ kind: 'kind', id: '' }],
    })).toThrow();
    expect(() => provenanceRecordSchema.parse({
      ...provenance,
      annotations: [{ kind: 'kind', id: '' }],
    })).toThrow();
    expect(() => provenanceRecordSchema.parse({
      ...provenance,
      environment: {
        runtime: 'python',
        runtime_version: '3.12',
        dependencies: { package: '' },
      },
    })).toThrow();
  });

  it('rejects unknown canonical fields', () => {
    expect(() => qecSessionSchema.parse({ ...fixture('minimal-session') as object, extra: true })).toThrow();
  });

  it('enforces bounded query resolution and exact selection shapes', () => {
    const query = {
      requestId: 'request-1',
      sessionId: 'session-1',
      datasetId: 'dataset-1',
      tile: 'heatmap',
      selection: { primary: null, scope: [], timeWindow: null, source: 'user' },
      resolution: { width: 1024, height: 768 },
      filters: { detector: 4, active: true },
    };
    expect(qecQuerySpecSchema.parse(query)).toEqual(query);
    const parsed = qecQuerySpecSchema.parse(query);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.filters)).toBe(true);
    expect(() => qecQuerySpecSchema.parse({ ...query, resolution: { width: 0, height: 768 } })).toThrow();
    expect(() => qecQuerySpecSchema.parse({ ...query, filters: { unsafe: [] } })).toThrow();
  });

  it('consumes Python canonical query frames without recomputing parsed-object bytes', () => {
    const shared = fixture('python-query-tile') as {
      event: { type: 'tile'; tile: { byteLength: number; content: unknown } };
      serializedFrame: string;
      frameByteLength: number;
      serverMeasuredTileBytes: number;
      boundary: { accepted: number; rejected: number };
    };
    const parsed = qecQueryResultSchema.parse(shared.event);

    expect(parsed.type).toBe('tile');
    expect(shared.event.tile.content).toEqual({
      points: [{ label: 'μ', small: 1e-7, whole: 1 }],
    });
    expect(shared.event.tile.byteLength).toBe(shared.serverMeasuredTileBytes);
    expect(new TextEncoder().encode(shared.serializedFrame).byteLength).toBe(
      shared.frameByteLength,
    );
    expect(shared.boundary).toEqual({
      accepted: QEC_TILE_MAX_BYTES,
      rejected: QEC_TILE_MAX_BYTES + 1,
    });
    expect(() => qecTilePayloadSchema.parse({
      ...shared.event.tile,
      byteLength: shared.event.tile.byteLength - 1,
    })).not.toThrow();
    expect(() => qecTilePayloadSchema.parse({
      ...shared.event.tile,
      byteLength: shared.boundary.rejected,
    })).toThrow();
  });
});
