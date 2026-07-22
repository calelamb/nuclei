import type { ImportMapping, ImportProbeResult } from '../../../types/qecDataProtocol';

export const IMPORT_STAGES = [
  'Source', 'Adapter', 'Mapping', 'Preview', 'Validation', 'Destination', 'Import',
] as const;
export type ImportStage = (typeof IMPORT_STAGES)[number];

export interface MappingRow {
  id: number;
  canonical: string;
  source: string;
}

export interface MappingOptions {
  outputKind: string;
  detectorCount: string;
  observableCount: string;
  timestampUnit: string;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

export function supportedAdapters(probe: ImportProbeResult | null): ImportProbeResult['results'] {
  return Object.freeze(
    [...(probe?.results ?? [])]
      .filter((adapter) => adapter.supported)
      .sort((left, right) => right.confidence - left.confidence),
  );
}

export function completeRows(rows: readonly MappingRow[]): readonly MappingRow[] {
  return Object.freeze(rows.filter((row) => row.canonical.trim() && row.source.trim()));
}

export function buildMapping(rows: readonly MappingRow[], options: MappingOptions): ImportMapping {
  const fields = Object.fromEntries(
    completeRows(rows).map((row) => [row.canonical.trim(), row.source.trim()]),
  );
  const numericOptions = [
    ['detector_count', options.detectorCount],
    ['observable_count', options.observableCount],
  ] as const;
  const explicitNumbers = Object.fromEntries(
    numericOptions.filter(([, value]) => value !== '').map(([key, value]) => [key, Number(value)]),
  );
  const explicitText = Object.fromEntries([
    ['output_kind', options.outputKind],
    ['timestamp_unit', options.timestampUnit],
  ].filter(([, value]) => value !== ''));
  return Object.freeze({ fields: Object.freeze(fields), options: Object.freeze({ ...explicitText, ...explicitNumbers }) });
}

export function stageDescription(stage: ImportStage): string {
  const descriptions: Record<ImportStage, string> = {
    Source: 'Verify the project-local source and immutable copy policy.',
    Adapter: 'Choose a compatible adapter from the probe results.',
    Mapping: 'State source-to-canonical meaning explicitly; nothing is guessed.',
    Preview: 'Inspect a bounded canonical summary and truncation disclosure.',
    Validation: 'Resolve blocking scientific meaning before data is written.',
    Destination: 'Name the canonical project-local session.',
    Import: 'Run the copy-only import and retain its durable lifecycle.',
  };
  return descriptions[stage];
}
