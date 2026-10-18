import { describe, expect, it } from 'vitest';
import {
  buildCertificateJson,
  certificatePaths,
  certificateStem,
  renderCertificateMarkdown,
  serializeCertificateJson,
} from './certificate';
import { gradientsPpeFixture, jobFixture, lintDiagnosticsFixture, scalingFixture } from './fixtures';

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
