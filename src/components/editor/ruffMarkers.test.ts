import { describe, it, expect } from 'vitest';
import { ruffDiagnosticsToMarkers } from './ruffMarkers';
import type { RuffDiagnostic } from '../../types/quantum';

// Stand-in for monaco.MarkerSeverity (Error=8, Warning=4).
const SEVERITY = { error: 8, warning: 4 };

const diag = (over: Partial<RuffDiagnostic>): RuffDiagnostic => ({
  line: 1, column: 8, end_line: 1, end_column: 10,
  severity: 'warning', code: 'F401', message: '`os` imported but unused',
  ...over,
});

describe('ruffDiagnosticsToMarkers', () => {
  it('maps positions 1:1 and appends the rule code to the message', () => {
    const [m] = ruffDiagnosticsToMarkers([diag({})], SEVERITY);
    expect(m).toMatchObject({
      severity: 4,
      startLineNumber: 1,
      startColumn: 8,
      endLineNumber: 1,
      endColumn: 10,
      source: 'ruff',
      code: 'F401',
    });
    expect(m.message).toContain('F401');
  });

  it('uses the error severity for syntax errors', () => {
    const [m] = ruffDiagnosticsToMarkers([diag({ severity: 'error', code: 'E999' })], SEVERITY);
    expect(m.severity).toBe(8);
  });

  it('widens a zero-width span so the squiggle is visible', () => {
    const [m] = ruffDiagnosticsToMarkers([diag({ column: 5, end_column: 5 })], SEVERITY);
    expect(m.endColumn).toBe(6);
  });

  it('maps every diagnostic', () => {
    const markers = ruffDiagnosticsToMarkers([diag({}), diag({ code: 'E501' })], SEVERITY);
    expect(markers).toHaveLength(2);
  });
});
