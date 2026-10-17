import { describe, it, expect } from 'vitest';
import {
  FONT, textWidth, computeMargins, layoutLegend, wrapLines, plotBox, layoutFigure, fitAxisTitle,
} from './qecPlotLayout';
import type { LegendGroup } from './qecPlotStyle';

const group = (n: number, kind: LegendGroup['kind'] = 'distance'): LegendGroup => ({
  kind, title: 'Distance',
  entries: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, label: `d = ${2 * i + 3}`, color: '#fff', shape: 'circle' as const })),
});

describe('typography constants', () => {
  it('are fixed pixel sizes', () => {
    expect(FONT.tick).toBe(11);
    expect(FONT.axisTitle).toBe(12);
  });
});

describe('textWidth', () => {
  it('grows with length and font size, and treats superscripts as narrower', () => {
    expect(textWidth('10⁻³', 11)).toBeGreaterThan(textWidth('10', 11));
    expect(textWidth('abcd', 12)).toBeGreaterThan(textWidth('abcd', 11));
    expect(textWidth('10⁻³', 11)).toBeLessThan(textWidth('10-3x', 11));
    expect(textWidth('', 11)).toBe(0);
  });
});

describe('computeMargins', () => {
  it('leaves room for the widest y tick label plus the rotated title, so neither is clipped', () => {
    const narrow = computeMargins({ yLabels: ['10⁻³'], xLabels: ['10⁻³'] });
    const wide = computeMargins({ yLabels: ['10⁻¹²'], xLabels: ['10⁻³'] });
    expect(wide.left).toBeGreaterThan(narrow.left);
    const need = textWidth('10⁻¹²', FONT.tick) + FONT.axisTitle;
    expect(wide.left).toBeGreaterThanOrEqual(need);
  });
  it('keeps room on the right for half of the last x label', () => {
    const m = computeMargins({ yLabels: ['10⁻³'], xLabels: ['2×10⁻³', '5×10⁻³'] });
    expect(m.right).toBeGreaterThanOrEqual(textWidth('5×10⁻³', FONT.tick) / 2);
  });
});

describe('layoutLegend', () => {
  it('keeps every item inside the available width and wraps to more rows when narrow', () => {
    const wide = layoutLegend([group(4)], 700);
    const narrow = layoutLegend([group(4)], 160);
    expect(wide.rows).toBe(1);
    expect(narrow.rows).toBeGreaterThan(1);
    for (const it of narrow.items) expect(it.x + it.width).toBeLessThanOrEqual(160);
    expect(narrow.height).toBeGreaterThan(wide.height);
  });
  it('never strands a group title at the end of a row away from its entries', () => {
    const l = layoutLegend([group(2), group(2, 'decoder')], 150);
    for (const h of l.items.filter((i) => i.type === 'header')) {
      const first = l.items.find((i) => i.type === 'entry' && i.group === h.group)!;
      expect(first.y).toBe(h.y);
    }
  });
  it('moves a whole group to the next row rather than orphaning its last entry (qec-09)', () => {
    const decoders = { kind: 'decoder' as const, title: 'Decoder', entries: ['fusion_blossom', 'pymatching'].map((label) => ({ id: label, label, color: '#000', shape: 'circle' as const })) };
    const distances = group(4);
    const one = layoutLegend([distances], 2000);
    const width = one.maxItemRight + 150;
    const l = layoutLegend([distances, decoders], width);
    const ys = l.items.filter((i) => i.group === 1).map((i) => i.y);
    expect(new Set(ys).size).toBe(1);
  });
  it('is empty for no groups', () => {
    expect(layoutLegend([], 500)).toMatchObject({ items: [], rows: 0, height: 0 });
  });
  it('includes a header per group and one item per entry', () => {
    const l = layoutLegend([group(2), group(3, 'decoder')], 800);
    expect(l.items.filter((i) => i.type === 'header')).toHaveLength(2);
    expect(l.items.filter((i) => i.type === 'entry')).toHaveLength(5);
  });
});

describe('wrapLines', () => {
  it('wraps long lines at word boundaries within the width', () => {
    const out = wrapLines(['alpha beta gamma delta epsilon zeta'], 12 * 6.6, 11);
    expect(out.length).toBeGreaterThan(1);
    for (const l of out) expect(textWidth(l, 11)).toBeLessThanOrEqual(12 * 6.6 + 1);
    expect(out.join(' ')).toBe('alpha beta gamma delta epsilon zeta');
  });
  it('never drops an over-long unbreakable word', () => {
    expect(wrapLines(['x'.repeat(80)], 100, 11)).toEqual(['x'.repeat(80)]);
  });
  it('returns nothing for no lines', () => {
    expect(wrapLines([], 300, 11)).toEqual([]);
  });
});

describe('plotBox', () => {
  it('goes side-by-side with the readout on wide containers and fills the height', () => {
    const b = plotBox({ width: 1100, height: 520 });
    expect(b.layout).toBe('row');
    expect(b.plotW).toBeLessThan(1100);
    expect(b.plotH).toBeGreaterThanOrEqual(220);
    expect(b.plotH).toBeLessThanOrEqual(520);
  });
  it('stacks on narrow containers with a clamped height', () => {
    const b = plotBox({ width: 640, height: 900 });
    expect(b.layout).toBe('stack');
    expect(b.plotW).toBe(640);
    expect(b.plotH).toBeGreaterThanOrEqual(220);
    expect(b.plotH).toBeLessThanOrEqual(460);
  });
  it('never returns a plot smaller than the minimum, even for a tiny container', () => {
    const b = plotBox({ width: 120, height: 80 });
    expect(b.plotW).toBeGreaterThanOrEqual(240);
    expect(b.plotH).toBeGreaterThanOrEqual(220);
  });
  it('falls back to a default size for an unmeasured container', () => {
    const b = plotBox({ width: 0, height: 0 });
    expect(b.plotW).toBeGreaterThan(0);
    expect(b.plotH).toBeGreaterThan(0);
  });
});

describe('layoutFigure', () => {
  const base = {
    yLabels: ['10⁻⁴', '10⁻³'], xLabels: ['10⁻³', '10⁻²'], legend: [group(4)],
    footerLines: [] as string[], noteLines: [] as string[],
  };
  it('fits the plot rectangle inside the figure for a fixed total height', () => {
    const l = layoutFigure({ ...base, width: 700, height: 420 });
    expect(l.plot.x).toBeGreaterThan(0);
    expect(l.plot.x + l.plot.w).toBeLessThanOrEqual(700);
    expect(l.plot.y + l.plot.h + l.margins.bottom + l.legendHeight + l.noteHeight + l.footerHeight).toBeLessThanOrEqual(420);
    expect(l.height).toBe(420);
  });
  it('derives the total height from a requested plot height (export)', () => {
    const l = layoutFigure({ ...base, width: 900, plotHeight: 400, footerLines: ['a', 'b', 'c'] });
    expect(l.plot.h).toBe(400);
    expect(l.footerHeight).toBeGreaterThan(0);
    expect(l.height).toBeGreaterThan(400 + l.footerHeight);
  });
  it('never gives the plot a negative size when the figure is tiny', () => {
    const l = layoutFigure({ ...base, width: 100, height: 100 });
    expect(l.plot.w).toBeGreaterThan(0);
    expect(l.plot.h).toBeGreaterThan(0);
  });
});

describe('fitAxisTitle', () => {
  it('uses the full title when it fits and the short one otherwise', () => {
    expect(fitAxisTitle('logical error per round', 'LER / round', 400)).toBe('logical error per round');
    expect(fitAxisTitle('logical error per round', 'LER / round', 120)).toBe('LER / round');
  });
});
