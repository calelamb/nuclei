import { describe, expect, it } from 'vitest';
import { buildTrainabilityContext, CONTEXT_CAPS } from './context';
import { inspectionFixture, jobFixture, lintDiagnosticsFixture, scalingFixture, gradientsFixture } from './fixtures';
import type { TrainabilityDiagnostic } from '../../types/trainability';

const base = {
  fileName: 'hea.py',
  observable: 'preset:global_z',
  inspection: inspectionFixture,
  job: jobFixture(),
  diagnostics: lintDiagnosticsFixture,
};

describe('buildTrainabilityContext', () => {
  it('returns nothing when there is nothing to say', () => {
    expect(buildTrainabilityContext({ ...base, inspection: null, job: null, diagnostics: [] })).toBe('');
    expect(
      buildTrainabilityContext({
        ...base,
        inspection: { ...inspectionFixture, parameters: [] },
        job: null,
        diagnostics: [],
      }),
    ).toBe('');
  });

  it('summarizes target, risk, scaling, Lie algebra and lint', () => {
    const text = buildTrainabilityContext(base);
    expect(text.startsWith('## Trainability Lab')).toBe(true);
    expect(text).toContain('Barren-plateau risk: high');
    expect(text).toContain('barren plateau');
    expect(text).toContain('so(16)');
    expect(text).toContain('TRN001');
  });

  it('discloses N of M when parameters are capped', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      name: `θ[${i}]`,
      mean: 0,
      variance: 0.01 * (i + 1),
      abs_mean: 0.1,
      variance_ci95: [0.001, 0.02] as [number, number],
    }));
    const job = jobFixture({ results: { gradients: { ...gradientsFixture, per_parameter: many } } });
    const text = buildTrainabilityContext({ ...base, job });
    expect(text).toContain(`showing ${CONTEXT_CAPS.parameters} of 30`);
    expect(text).toContain('θ[0]=0.01');
    expect(text).not.toContain('θ[29]');
  });

  it('caps scaling points and diagnostics with disclosures', () => {
    const points = Array.from({ length: 12 }, (_, i) => ({ ...scalingFixture.points[0], n_qubits: i + 2 }));
    const diagnostics: TrainabilityDiagnostic[] = Array.from({ length: 9 }, (_, i) => ({
      ...lintDiagnosticsFixture[1],
      code: `TRN9${i}`,
    }));
    const job = jobFixture({ results: { scaling: { ...scalingFixture, points } } });
    const text = buildTrainabilityContext({ ...base, job, diagnostics });
    expect(text).toContain(`showing ${CONTEXT_CAPS.scalingPoints} of 12`);
    expect(text).toContain(`showing ${CONTEXT_CAPS.diagnostics} of 9`);
  });

  it('flags stale results and failed analyses', () => {
    const job = jobFixture({ errors: { landscape: { code: 'oom', message: 'too big' } } });
    const text = buildTrainabilityContext({ ...base, job, stale: true });
    expect(text).toContain('may be stale');
    expect(text).toContain('Failed analyses: landscape');
  });

  it('hard-caps total length', () => {
    const long = 'x'.repeat(CONTEXT_CAPS.maxChars * 2);
    const text = buildTrainabilityContext({ ...base, fileName: long });
    expect(text.length).toBeLessThanOrEqual(CONTEXT_CAPS.maxChars + 80);
    expect(text).toContain('context truncated');
  });
});
