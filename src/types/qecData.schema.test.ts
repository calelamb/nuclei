import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
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
    expect(() => qecQuerySpecSchema.parse({ ...query, resolution: { width: 0, height: 768 } })).toThrow();
    expect(() => qecQuerySpecSchema.parse({ ...query, filters: { unsafe: [] } })).toThrow();
  });
});
