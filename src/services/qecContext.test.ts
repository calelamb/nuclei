import { describe, it, expect } from 'vitest';
import { buildQecContext, QEC_CONTEXT_ROW_CAP } from './qecContext';
import { BUILT_IN_NOISE_MODELS } from '../types/noiseModel';
import type { QecCampaignSpec } from '../types/experiment';
import type { QecCampaignStatsRow, QecSnapshot } from '../types/qec';

const SPEC: QecCampaignSpec = {
  schema: 2,
  type: 'qec_campaign',
  name: 'surface-study',
  source: { entry: 'qec/surface_memory.py' },
  noise: { model: 'uniform_depolarizing', p: { range: [0.001, 0.006, 0.001] } },
  decoders: ['pymatching'],
  collect: { max_shots: 100000, max_errors: 500 },
  workers: 'auto',
};

function row(d: number, p: number, errors: number, shots = 100000): QecCampaignStatsRow {
  return {
    strong_id: `${d}-${p}`,
    decoder: 'pymatching',
    shots,
    errors,
    seconds: 1,
    json_metadata: { label: `d=${d}`, d, p, decoder: 'pymatching' },
  } as QecCampaignStatsRow;
}

const SNAPSHOT = {
  num_detectors: 24,
  num_observables: 1,
  dem: { edge_count: 40, boundary_edge_count: 8, edges: [], boundary_edges: [] },
} as unknown as QecSnapshot;

describe('buildQecContext', () => {
  const noiseModel = BUILT_IN_NOISE_MODELS.find((m) => m.name === 'uniform_depolarizing')!;

  it('summarizes the campaign, noise model, DEM, and rows', () => {
    const text = buildQecContext({
      campaignName: SPEC.name,
      spec: SPEC,
      noiseModel,
      snapshot: SNAPSHOT,
      circuit: null,
      rows: [row(3, 0.001, 100), row(5, 0.001, 10), row(7, 0.001, 1)],
      running: false,
    });
    expect(text).toContain('QEC Campaign: surface-study');
    expect(text).toContain('entry qec/surface_memory.py');
    expect(text).toContain('uniform_depolarizing');
    expect(text).toContain('Detectors: 24');
    expect(text).toContain('40 pairwise edges + 8 boundary edges');
    expect(text).toContain('Campaign results (3 of 3 rows)');
    // Λ present because distances 3/5/7 suppress errors at fixed p.
    expect(text).toContain('Λ=');
  });

  it('caps injected rows and says how many were dropped', () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(3 + (i % 3) * 2, 0.001 + i * 1e-5, i + 1));
    const text = buildQecContext({
      campaignName: SPEC.name,
      spec: SPEC,
      noiseModel,
      snapshot: null,
      circuit: null,
      rows,
      running: true,
    });
    expect(text).toContain(`Campaign results (${QEC_CONTEXT_ROW_CAP} of 40 rows)`);
    expect(text).toContain('(running)');
  });

  it('reports an unavailable DEM instead of pretending', () => {
    const text = buildQecContext({
      campaignName: SPEC.name,
      spec: SPEC,
      noiseModel,
      snapshot: { num_detectors: 0, num_observables: 0, dem: null, dem_error: 'no detectors defined' } as unknown as QecSnapshot,
      circuit: null,
      rows: [],
      running: false,
    });
    expect(text).toContain('Unavailable: no detectors defined');
  });
});
