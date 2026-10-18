/**
 * PRD 14 §3.1 — map `trainability_lint` diagnostics to Monaco markers
 * (owner `'trainability'`). Structural like `ruffMarkers`: the real
 * `MarkerSeverity` values are passed in so this is unit-testable without
 * loading monaco.
 */

import type { TrainabilityDiagnostic, TrainabilitySeverity } from '../../types/trainability';

export const TRAINABILITY_MARKER_OWNER = 'trainability';

export interface TrainabilityMarker {
  severity: number;
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  source: string;
  code: string;
}

export interface MarkerSeverityMap {
  error: number;
  warning: number;
  info: number;
}

export interface LintMarkerOptions {
  severity: MarkerSeverityMap;
  /** Number of lines in the model; markers outside 1..lineCount are dropped. */
  lineCount: number;
  /** Returns the last column of a line (`model.getLineMaxColumn`). */
  lineMaxColumn: (line: number) => number;
}

const SEVERITY_KEY: Record<TrainabilitySeverity, keyof MarkerSeverityMap> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
};

/** "Title: message — Citation label" so the marker is self-explanatory. */
export function formatMarkerMessage(diagnostic: TrainabilityDiagnostic): string {
  const base = `${diagnostic.title}: ${diagnostic.message}`;
  return diagnostic.citation ? `${base} (${diagnostic.citation.label})` : base;
}

/**
 * Diagnostics without a source line (e.g. TRN007, or a summary-level finding)
 * never become markers; they live in the verdict rail only.
 */
export function lintToMarkers(diagnostics: readonly TrainabilityDiagnostic[], options: LintMarkerOptions): TrainabilityMarker[] {
  const markers: TrainabilityMarker[] = [];
  for (const d of diagnostics) {
    if (d.code === 'TRN007') continue;
    if (d.line === null || !Number.isInteger(d.line)) continue;
    if (d.line < 1 || d.line > options.lineCount) continue;
    markers.push({
      severity: options.severity[SEVERITY_KEY[d.severity]],
      message: formatMarkerMessage(d),
      startLineNumber: d.line,
      startColumn: 1,
      endLineNumber: d.line,
      endColumn: Math.max(2, options.lineMaxColumn(d.line)),
      source: 'nuclei trainability',
      code: d.code,
    });
  }
  return markers;
}
