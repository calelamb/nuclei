import { describe, expect, it } from 'vitest';
import { formatMarkerMessage, lintToMarkers, TRAINABILITY_MARKER_OWNER } from './lintMarkers';
import { lintDiagnosticsFixture } from './fixtures';
import type { TrainabilityDiagnostic } from '../../types/trainability';

const SEVERITY = { error: 8, warning: 4, info: 2 };
const options = (lineCount = 20) => ({ severity: SEVERITY, lineCount, lineMaxColumn: (line: number) => line + 10 });

describe('lintToMarkers', () => {
  it('uses the trainability owner constant', () => {
    expect(TRAINABILITY_MARKER_OWNER).toBe('trainability');
  });

  it('maps severity, range, code and puts the citation in the message', () => {
    const [marker] = lintToMarkers(lintDiagnosticsFixture, options());
    expect(marker).toMatchObject({
      severity: SEVERITY.warning,
      startLineNumber: 9,
      endLineNumber: 9,
      startColumn: 1,
      endColumn: 19,
      code: 'TRN001',
    });
    expect(marker.message).toContain('Global cost function');
    expect(marker.message).toContain('Cerezo et al., Nat. Commun. 12, 1791 (2021)');
  });

  it('maps info and error severities', () => {
    const markers = lintToMarkers(lintDiagnosticsFixture, options());
    expect(markers.find((m) => m.code === 'TRN004')?.severity).toBe(SEVERITY.info);
    const error: TrainabilityDiagnostic = { ...lintDiagnosticsFixture[0], code: 'TRN900', severity: 'error', line: 1 };
    expect(lintToMarkers([error], options())[0].severity).toBe(SEVERITY.error);
  });

  it('drops diagnostics without a line, TRN007, and lines outside the model', () => {
    const base = lintDiagnosticsFixture[0];
    const markers = lintToMarkers(
      [
        { ...base, code: 'TRN100', line: null },
        { ...base, code: 'TRN007', line: 3 },
        { ...base, code: 'TRN101', line: 0 },
        { ...base, code: 'TRN102', line: 99 },
        { ...base, code: 'TRN103', line: 5 },
      ],
      options(10),
    );
    expect(markers.map((m) => m.code)).toEqual(['TRN103']);
  });

  it('guarantees a non-empty range on empty lines', () => {
    const [marker] = lintToMarkers([{ ...lintDiagnosticsFixture[0], line: 2 }], { ...options(), lineMaxColumn: () => 1 });
    expect(marker.endColumn).toBeGreaterThan(marker.startColumn);
  });

  it('omits the citation parenthetical when there is none', () => {
    expect(formatMarkerMessage(lintDiagnosticsFixture[1])).toBe('Dead parameter: θ[5] cannot affect the cost: its generator commutes with the observable.');
  });
});
