import { SUPERSCRIPT_CHARS } from './qecPlotFormat';
import type { LegendGroup } from './qecPlotStyle';

/** Fixed pixel typography: text never scales with panel width. */
export const FONT = { tick: 11, axisTitle: 12, legend: 11, note: 10 } as const;

const CHAR_EM = 0.58;
const SUPERSCRIPT_EM = 0.42;
const LINE_HEIGHT = 16;
const TICK_LEN = 5;
const OUTER_PAD = 8;

/** Conservative width estimate for proportional UI text. */
export function textWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) em += SUPERSCRIPT_CHARS.includes(ch) ? SUPERSCRIPT_EM : CHAR_EM;
  return em * fontSize;
}

export interface Margins { left: number; right: number; top: number; bottom: number }

/** Margins in pixels sized from the actual tick labels so nothing is clipped. */
export function computeMargins(args: { yLabels: readonly string[]; xLabels: readonly string[] }): Margins {
  const widest = (xs: readonly string[]) => Math.max(0, ...xs.map((t) => textWidth(t, FONT.tick)));
  const lastX = args.xLabels.length > 0 ? textWidth(args.xLabels[args.xLabels.length - 1], FONT.tick) : 0;
  return {
    left: OUTER_PAD + FONT.axisTitle + 8 + widest(args.yLabels) + 4 + TICK_LEN,
    right: Math.max(14, Math.ceil(lastX / 2) + 4),
    top: 12,
    bottom: TICK_LEN + 4 + FONT.tick + 8 + FONT.axisTitle + 6,
  };
}

// ───────────────────────────── legend ─────────────────────────────

export interface LegendItem {
  type: 'header' | 'entry';
  group: number;
  /** Entry index inside its group (entries only). */
  entry: number;
  text: string;
  x: number;
  y: number;
  width: number;
}

export interface LegendLayout {
  items: LegendItem[];
  rows: number;
  height: number;
  maxItemRight: number;
}

const SWATCH_W = 26;
const SWATCH_GAP = 6;
const ITEM_GAP = 14;

export function layoutLegend(groups: readonly LegendGroup[], maxWidth: number): LegendLayout {
  const items: LegendItem[] = [];
  let x = 0;
  let row = 0;
  const place = (type: LegendItem['type'], group: number, entry: number, text: string, width: number) => {
    if (x > 0 && x + width > maxWidth) { row += 1; x = 0; }
    items.push({ type, group, entry, text, x, y: row * LINE_HEIGHT, width });
    x += width + ITEM_GAP;
  };
  groups.forEach((g, gi) => {
    const headerW = textWidth(g.title, FONT.legend);
    // Keep a group title on the same row as its first entry.
    const firstW = g.entries[0] ? ITEM_GAP + SWATCH_W + SWATCH_GAP + textWidth(g.entries[0].label, FONT.legend) : 0;
    if (x > 0 && x + headerW + firstW > maxWidth) { row += 1; x = 0; }
    place('header', gi, -1, g.title, headerW);
    g.entries.forEach((e, ei) => place('entry', gi, ei, e.label, SWATCH_W + SWATCH_GAP + textWidth(e.label, FONT.legend)));
  });
  const rows = items.length === 0 ? 0 : row + 1;
  const maxItemRight = items.reduce((m, i) => Math.max(m, i.x + i.width), 0);
  return { items, rows, height: rows * LINE_HEIGHT, maxItemRight };
}

export const LEGEND_SWATCH_WIDTH = SWATCH_W;
export const LEGEND_SWATCH_GAP = SWATCH_GAP;

// ───────────────────────────── text blocks ─────────────────────────────

/** Greedy word wrap by estimated width; an over-long word is kept whole. */
export function wrapLines(lines: readonly string[], maxWidth: number, fontSize: number): string[] {
  return lines.flatMap((line) => {
    const out: string[] = [];
    let current = '';
    for (const word of line.split(/\s+/).filter(Boolean)) {
      const next = current ? `${current} ${word}` : word;
      if (current && textWidth(next, fontSize) > maxWidth) { out.push(current); current = word; } else current = next;
    }
    if (current) out.push(current);
    return out;
  });
}

// ───────────────────────────── container -> plot box ─────────────────────────────

export const READOUT_WIDTH = 300;
export const WIDE_MIN_WIDTH = 780;
export const MIN_PLOT_W = 240;
export const MIN_PLOT_H = 220;
const STACK_MAX_H = 460;
const DEFAULT_BOX = { width: 640, height: 400 };
const TOP_STRIP = 16;
const RIGHT_PAD = 12;
const GUTTER = 12;

export interface PlotBox { layout: 'row' | 'stack'; plotW: number; plotH: number }

/**
 * Size of the plot for a measured container. Wide containers put the Λ readout
 * beside the plot (plot fills the height); narrow ones stack it below with a
 * height in proportion to the width.
 */
export function plotBox(container: { width: number; height: number }): PlotBox {
  const w = container.width > 0 ? container.width : DEFAULT_BOX.width;
  const h = container.height > 0 ? container.height : DEFAULT_BOX.height;
  if (w >= WIDE_MIN_WIDTH) {
    const plotW = w - READOUT_WIDTH - GUTTER - RIGHT_PAD;
    return { layout: 'row', plotW, plotH: Math.max(MIN_PLOT_H, h - TOP_STRIP) };
  }
  const plotW = Math.max(MIN_PLOT_W, w);
  const wanted = Math.min(plotW * 0.62, h - TOP_STRIP);
  return { layout: 'stack', plotW, plotH: Math.round(Math.min(STACK_MAX_H, Math.max(MIN_PLOT_H, wanted))) };
}

// ───────────────────────────── whole figure ─────────────────────────────

export interface FigureLayoutInput {
  width: number;
  /** Total figure height; ignored when plotHeight is given. */
  height?: number;
  /** Fixed plot-area height; the total height is derived (used by export). */
  plotHeight?: number;
  yLabels: readonly string[];
  xLabels: readonly string[];
  legend: readonly LegendGroup[];
  noteLines: readonly string[];
  footerLines: readonly string[];
}

export interface FigureLayout {
  width: number;
  height: number;
  margins: Margins;
  plot: { x: number; y: number; w: number; h: number };
  legend: LegendLayout;
  legendY: number;
  legendHeight: number;
  noteLines: string[];
  noteY: number;
  noteHeight: number;
  footerLines: string[];
  footerY: number;
  footerHeight: number;
}

const NOTE_LINE = 14;
const BLOCK_GAP = 8;
const MIN_INNER = 40;

export function layoutFigure(input: FigureLayoutInput): FigureLayout {
  const margins = computeMargins({ yLabels: input.yLabels, xLabels: input.xLabels });
  const inner = Math.max(MIN_INNER, input.width - margins.left - margins.right);
  const legendBlock = layoutLegend(input.legend, input.width - 2 * OUTER_PAD);
  const noteLines = wrapLines(input.noteLines, input.width - 2 * OUTER_PAD, FONT.note);
  const footerLines = wrapLines(input.footerLines, input.width - 2 * OUTER_PAD, FONT.note);
  const legendHeight = legendBlock.height > 0 ? legendBlock.height + BLOCK_GAP : 0;
  const noteHeight = noteLines.length > 0 ? noteLines.length * NOTE_LINE + BLOCK_GAP : 0;
  const footerHeight = footerLines.length > 0 ? footerLines.length * NOTE_LINE + BLOCK_GAP : 0;
  const chrome = margins.top + margins.bottom + legendHeight + noteHeight + footerHeight;
  const plotH = input.plotHeight ?? Math.max(MIN_INNER, (input.height ?? 0) - chrome);
  const height = input.plotHeight !== undefined ? plotH + chrome : (input.height ?? plotH + chrome);
  const plotBottom = margins.top + plotH;
  const legendY = plotBottom + margins.bottom + (legendHeight > 0 ? BLOCK_GAP : 0);
  const noteY = legendY + legendBlock.height + (noteHeight > 0 ? BLOCK_GAP : 0);
  const footerY = noteY + noteLines.length * NOTE_LINE + (footerHeight > 0 ? BLOCK_GAP : 0);
  return {
    width: input.width, height, margins,
    plot: { x: margins.left, y: margins.top, w: inner, h: plotH },
    legend: legendBlock, legendY, legendHeight,
    noteLines, noteY, noteHeight, footerLines, footerY, footerHeight,
  };
}

export const FIGURE_PAD = OUTER_PAD;
export const NOTE_LINE_HEIGHT = NOTE_LINE;
export const TICK_LENGTH = TICK_LEN;
