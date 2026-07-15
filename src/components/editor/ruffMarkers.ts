import type { RuffDiagnostic } from '../../types/quantum';

/** A Monaco `IMarkerData`-shaped object (kept structural so this maps without a
 * monaco import — the effect that applies it passes the real severity enum). */
export interface RuffMarker {
  severity: number;
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  source: string;
  code: string;
}

/** Map ruff diagnostics (1-based positions) to Monaco markers. `severity`
 * carries the real `MarkerSeverity.Error`/`.Warning` values so this stays
 * unit-testable without loading monaco. */
export function ruffDiagnosticsToMarkers(
  diagnostics: RuffDiagnostic[],
  severity: { error: number; warning: number },
): RuffMarker[] {
  return diagnostics.map((d) => ({
    severity: d.severity === 'error' ? severity.error : severity.warning,
    message: `${d.message} (${d.code})`,
    startLineNumber: d.line,
    startColumn: d.column,
    endLineNumber: d.end_line,
    // Guarantee a non-empty range so the squiggle is visible even when ruff
    // reports a zero-width span.
    endColumn: Math.max(d.end_column, d.column + 1),
    source: 'ruff',
    code: d.code,
  }));
}
