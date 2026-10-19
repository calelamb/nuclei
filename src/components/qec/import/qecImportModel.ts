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
  bitOrder: string;
}

export function sessionIdIssue(value: string): string | null {
  if (value.length === 0) return 'choose a destination session ID';
  if (Array.from(value).length > MAX_ID_LENGTH) return 'session ID must be 128 characters or fewer';
  if (value === '.' || value === '..') return 'session ID cannot be . or ..';
  if ([...value].some((character) => '<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 32)) {
    return 'session ID contains a forbidden character';
  }
  if (!KERNEL_ID_PATTERN.test(value)) {
    return 'use letters, numbers, dot, dash or underscore (max 128), starting with a letter or number';
  }
  return null;
}

const KERNEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_ID_LENGTH = 128;
const DATE_SUFFIX_LENGTH = 11;

/** `<file basename>-<YYYY-MM-DD>` in the kernel's identifier grammar, so the default never fails at import. */
export function suggestSessionId(source: string, now: Date = new Date()): string {
  const file = source.split(/[\\/]/).filter(Boolean).pop() ?? '';
  const stem = file
    .replace(/\.[^.]*$/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, MAX_ID_LENGTH - DATE_SUFFIX_LENGTH);
  const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-');
  return `${stem || 'import'}-${day}`;
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

const NATIVE_MAPPING_ADAPTERS = new Set(['stim-results', 'sinter-csv']);

export function adapterUsesNativeMapping(adapterId: string): boolean {
  return NATIVE_MAPPING_ADAPTERS.has(adapterId);
}

/** Sinter's statistics schema defines every field and unit, so there is nothing for a person to map or review. */
export function adapterNeedsNoMapping(adapterId: string): boolean {
  return adapterId === 'sinter-csv';
}

export function mappingIsReviewed(
  adapterId: string,
  rows: readonly MappingRow[],
  options: MappingOptions,
  reviewed: boolean,
): boolean {
  if (adapterNeedsNoMapping(adapterId)) return true;
  if (!reviewed) return false;
  if (adapterId === 'stim-results') {
    const detectors = Number(options.detectorCount);
    const observables = Number(options.observableCount);
    return options.detectorCount !== ''
      && options.observableCount !== ''
      && Number.isSafeInteger(detectors)
      && detectors > 0
      && Number.isSafeInteger(observables)
      && observables >= 0;
  }
  return adapterId === 'sinter-csv' || completeRows(rows).length > 0;
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
    ['bit_order', options.bitOrder],
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

const ADAPTER_NAMES: Readonly<Record<string, string>> = Object.freeze({
  'sinter-csv': 'sinter CSV',
  'stim-results': 'Stim results',
});

/** Human display name for an adapter id ("sinter-csv" -> "sinter CSV"). */
export function adapterDisplayName(adapterId: string): string {
  const known = ADAPTER_NAMES[adapterId];
  if (known) return known;
  const spaced = adapterId.replaceAll('-', ' ');
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}`;
}

/** "1 canonical partition" / "46 records". */
export function countLabel(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`;
}
