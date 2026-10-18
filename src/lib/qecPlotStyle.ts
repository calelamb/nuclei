import type { ThresholdSeries } from '../types/qecStats';
import type { ThemeMode } from '../styles/tokens';

export type MarkerShape =
  | 'circle' | 'square' | 'diamond' | 'cross'
  | 'triangle' | 'plus' | 'hollow-circle' | 'hollow-square';

export interface SeriesStyle {
  color: string;
  shape: MarkerShape;
  /** SVG dash array, undefined for a solid line. */
  dash?: string;
}

export type LegendKind = 'distance' | 'decoder' | 'experiment';

export interface LegendEntry {
  id: string;
  label: string;
  color: string;
  shape: MarkerShape;
  dash?: string;
}

export interface LegendGroup {
  kind: LegendKind;
  title: string;
  entries: LegendEntry[];
}

/** Teal leads (the product accent); purple and fuchsia are reserved for Dirac, so the last slot is a warm neutral. */
export const DISTANCE_PALETTE: Readonly<Record<ThemeMode, readonly string[]>> = {
  dark: ['#48CAE4', '#FBBF24', '#FB7185', '#4ADE80', '#7DA2FF', '#FB923C', '#CBD5E1', '#D6A77A'],
  light: ['#0891B2', '#CA8A04', '#DC2626', '#15803D', '#2563EB', '#DB2777', '#475569', '#92400E'],
};

export const SHAPES: readonly MarkerShape[] = [
  'circle', 'square', 'diamond', 'cross', 'triangle', 'plus', 'hollow-circle', 'hollow-square',
];
const DASHES: ReadonlyArray<string | undefined> = [undefined, '7 3', '2 3', '8 3 2 3'];

function channel(hex: string, i: number): number {
  const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}

const sortedUnique = <T,>(xs: T[], cmp: (a: T, b: T) => number) => [...new Set(xs)].sort(cmp);

/**
 * Colour per distance, marker shape per decoder, dash per experiment (or per decoder when there is one experiment). Each
 * channel redundantly encodes something the legend lists, so the figure still
 * reads in greyscale or for colour-blind readers.
 */
export function buildPlotStyle(
  series: readonly ThresholdSeries[], mode: ThemeMode, neutral: string,
): { byKey: Map<string, SeriesStyle>; legend: LegendGroup[] } {
  const palette = DISTANCE_PALETTE[mode];
  const distances = sortedUnique(series.map((s) => s.distance), (a, b) => (a ?? Infinity) - (b ?? Infinity));
  const decoders = sortedUnique(series.map((s) => s.decoder), (a, b) => a.localeCompare(b));
  const labels = sortedUnique(series.map((s) => s.label), (a, b) => a.localeCompare(b));

  const colorOf = (d: number | null) => palette[distances.indexOf(d) % palette.length];
  const shapeOf = (dec: string) => SHAPES[decoders.indexOf(dec) % SHAPES.length];
  // Dash encodes the experiment when several are plotted; with one, the channel is free and
  // separates decoders so they stay apart in greyscale beyond marker shape alone.
  const dashByExperiment = labels.length > 1;
  const dashOf = (label: string) => DASHES[labels.indexOf(label) % DASHES.length];
  const dashOfDecoder = (dec: string) => (dashByExperiment ? undefined : DASHES[decoders.indexOf(dec) % DASHES.length]);

  const byKey = new Map(series.map((s) => [
    s.key, { color: colorOf(s.distance), shape: shapeOf(s.decoder), dash: dashByExperiment ? dashOf(s.label) : dashOfDecoder(s.decoder) } satisfies SeriesStyle,
  ]));

  const legend: LegendGroup[] = [{
    kind: 'distance', title: 'Distance',
    entries: distances.map((d) => ({ id: `d${d}`, label: `d = ${d ?? '?'}`, color: colorOf(d), shape: 'circle' as const })),
  }];
  if (decoders.length > 1) {
    legend.push({
      kind: 'decoder', title: 'Decoder',
      entries: decoders.map((dec) => ({ id: dec, label: dec, color: neutral, shape: shapeOf(dec), dash: dashOfDecoder(dec) })),
    });
  }
  if (labels.length > 1) {
    legend.push({
      kind: 'experiment', title: 'Experiment',
      entries: labels.map((l) => ({ id: l, label: l, color: neutral, shape: 'circle' as const, dash: dashOf(l) })),
    });
  }
  return { byKey, legend };
}
