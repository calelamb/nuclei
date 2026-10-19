import { describe, expect, it } from 'vitest';
import {
  buildCertificateJson,
  certificatePaths,
  certificateStem,
  renderCertificateMarkdown,
  serializeCertificateJson,
} from './certificate';
import {
  gradientsFixture,
  gradientsPpeFixture,
  gradientsPpeUnresolvedFixture,
  jobFixture,
  lieFixture,
  lintDiagnosticsFixture,
  scalingFailedPointFixture,
  scalingFixture,
} from './fixtures';

const CREATED = '2026-10-18T12:00:00.000Z';
const input = { job: jobFixture(), diagnostics: lintDiagnosticsFixture, createdAt: CREATED };

describe('certificate paths', () => {
  it('derives experiments/<stem>.trainability.{json,md}', () => {
    expect(certificatePaths('ansatz/hardware_efficient.py')).toEqual({
      json: 'experiments/hardware_efficient.trainability.json',
      markdown: 'experiments/hardware_efficient.trainability.md',
    });
    expect(certificateStem('weird name (1).py')).toBe('weird_name_1_');
    expect(certificateStem('')).toBe('untitled');
  });
});

describe('certificate JSON', () => {
  it('carries verdicts, provenance, results and lint', () => {
    const doc = buildCertificateJson(input);
    expect(doc.schema).toBe('nuclei.trainability.certificate/1');
    expect(doc.verdicts.trainability.risk).toBe('high');
    expect(doc.verdicts.scaling).toBe('barren_plateau');
    expect(doc.provenance?.code_sha256).toHaveLength(64);
    expect(doc.results.lie?.dimension).toBe(120);
    expect(doc.lint).toHaveLength(lintDiagnosticsFixture.length);
  });

  it('serializes with a trailing newline and is deterministic', () => {
    const a = serializeCertificateJson(buildCertificateJson(input));
    const b = serializeCertificateJson(buildCertificateJson(input));
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
  });
});

describe('certificate Markdown', () => {
  it('matches the snapshot', () => {
    expect(renderCertificateMarkdown(input)).toMatchSnapshot();
  });

  it('labels PPE intervals as truncation intervals, not CIs', () => {
    const job = jobFixture({ results: { gradients: gradientsPpeFixture, scaling: scalingFixture } });
    const md = renderCertificateMarkdown({ ...input, job });
    expect(md).toContain('truncation interval (rigorous)');
    expect(md).toContain('Pauli propagation');
  });

  it('states missing provenance and analysis errors honestly', () => {
    const job = jobFixture({ provenance: null, errors: { landscape: { code: 'oom', message: 'too large' } }, results: {} });
    const md = renderCertificateMarkdown({ ...input, job, diagnostics: [] });
    expect(md).toContain('Code SHA-256: `unavailable`');
    expect(md).toContain('landscape: too large (oom)');
    expect(md).toContain('No evidence yet');
  });
});

describe('certificate with kernel-shaped nulls (CR-H1, PH-C2)', () => {
  const BAD = /\bnull\b|\bundefined\b|\bNaN\b/;
  const render = (results: Parameters<typeof jobFixture>[0]) =>
    renderCertificateMarkdown({ job: jobFixture(results), diagnostics: [], createdAt: CREATED });

  it('prints a complete PPE result as exact, with the truncation interval, and no null', () => {
    const md = render({ results: { gradients: gradientsPpeFixture } });
    expect(md).toContain('exact Pauli propagation, no sampling');
    expect(md).toContain('truncation interval (rigorous) [0.0114, 0.0116]');
    expect(md).not.toMatch(BAD);
  });

  it('states unresolved gates as interval only, with the kernel note', () => {
    const md = render({ results: { gradients: gradientsPpeUnresolvedFixture } });
    expect(md).toContain('Mean variance unresolved: only the truncation interval (rigorous) [0, 0.968] is rigorous.');
    expect(md).toContain('unresolved (interval only)');
    expect(md).toContain('Note: Pauli propagation hit its budget');
    expect(md).not.toMatch(BAD);
  });

  it('lists failed scaling points and a null preferred model without printing null', () => {
    const md = render({ results: { scaling: scalingFailedPointFixture } });
    expect(md).toContain('failed (ppe_budget_exceeded)');
    expect(md).toContain('Preferred: none');
    expect(md).not.toMatch(BAD);
    expect(md).not.toMatch(/Inconclusive: Inconclusive/);
  });

  it('says which quantity Ragone predicts and compares it with the empirical cost variance', () => {
    const md = render({ results: { lie: lieFixture, gradients: gradientsFixture } });
    expect(md).toContain('Predicted cost variance Var[C] (Ragone et al.): 0.0089.');
    expect(md).toContain('Empirical cost variance Var[C]: 0.0107.');
    expect(md).toContain('Empirical / predicted = 1.2.');
    expect(md).not.toContain('Predicted variance (Ragone');
  });

  it('omits the ratio when the empirical cost variance is missing', () => {
    const md = render({ results: { lie: lieFixture, gradients: gradientsPpeFixture } });
    expect(md).toContain('Empirical cost variance: not measured.');
    expect(md).not.toContain('Empirical / predicted');
  });

  it('reports a parameter-free circuit as N/A rather than a risk level', () => {
    const md = render({ target: { ...jobFixture().target, nParameters: 0 } });
    expect(md).toContain('N/A (no free parameters)');
    expect(md).not.toContain('Barren-plateau risk: LOW');
  });

  it('softens the TRN003 wording in the lint section', () => {
    const md = renderCertificateMarkdown({
      job: jobFixture(),
      diagnostics: [
        {
          code: 'TRN003',
          severity: 'info',
          title: 'Polynomial dynamical Lie algebra',
          message: 'dim 𝔤 = 15 ≤ 4n² = 36: the circuit is trainable in the barren-plateau sense but likely classically simulable with 𝔤-sim.',
          citation: null,
          line: null,
          source_indices: [],
        },
      ],
      createdAt: CREATED,
    });
    expect(md).not.toContain('is trainable in the barren-plateau sense');
    expect(md).toContain('does not bound the gradient variance');
  });
});
