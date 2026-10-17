import { describe, it, expect } from 'vitest';
import type { ThresholdSeries } from '../types/qecStats';
import { buildPlotStyle, DISTANCE_PALETTE, luminance } from './qecPlotStyle';

const mk = (label: string, distance: number | null, decoder: string): ThresholdSeries => ({
  key: `${label}·d${distance}·${decoder}`, label, distance, decoder,
  points: [{ noise: 0.001, rate: { p: 0.01, lo: 0.005, hi: 0.02 } }],
});
const grid = (decoders: string[], label = 'exp') =>
  [3, 5, 7, 9].flatMap((d) => decoders.map((dec) => mk(label, d, dec)));

describe('palette', () => {
  it.each(['dark', 'light'] as const)('has 6+ distinct colours in %s mode', (mode) => {
    const colors = DISTANCE_PALETTE[mode];
    expect(new Set(colors).size).toBe(colors.length);
    expect(colors.length).toBeGreaterThanOrEqual(6);
  });
  it('keeps every colour legible on its background', () => {
    const bg = { dark: '#0D131E', light: '#FFFFFF' } as const;
    for (const mode of ['dark', 'light'] as const) {
      for (const c of DISTANCE_PALETTE[mode]) {
        const [a, b] = [luminance(c), luminance(bg[mode])].sort((x, y) => y - x);
        expect((a + 0.05) / (b + 0.05)).toBeGreaterThan(2.9);
      }
    }
  });
});

describe('buildPlotStyle', () => {
  it('gives each distance its own colour, shared across decoders', () => {
    const { byKey } = buildPlotStyle(grid(['mwpm', 'uf']), 'dark', '#999');
    const colors = new Set([3, 5, 7, 9].map((d) => byKey.get(`exp·d${d}·mwpm`)!.color));
    expect(colors.size).toBe(4);
    expect(byKey.get('exp·d5·mwpm')!.color).toBe(byKey.get('exp·d5·uf')!.color);
  });

  it('distinguishes decoders by marker shape, not colour alone', () => {
    const { byKey } = buildPlotStyle(grid(['mwpm', 'uf']), 'light', '#999');
    expect(byKey.get('exp·d3·mwpm')!.shape).not.toBe(byKey.get('exp·d3·uf')!.shape);
  });

  it('distinguishes experiments by dash when several share a distance', () => {
    const series = [...grid(['mwpm'], 'a'), ...grid(['mwpm'], 'b')];
    const { byKey, legend } = buildPlotStyle(series, 'dark', '#999');
    expect(byKey.get('a·d3·mwpm')!.dash).not.toBe(byKey.get('b·d3·mwpm')!.dash);
    expect(legend.map((g) => g.kind)).toContain('experiment');
  });

  it('lists every distance and decoder in the legend, and omits groups with one member', () => {
    const multi = buildPlotStyle(grid(['mwpm', 'uf']), 'dark', '#999').legend;
    expect(multi.find((g) => g.kind === 'distance')!.entries.map((e) => e.label)).toEqual(['d = 3', 'd = 5', 'd = 7', 'd = 9']);
    expect(multi.find((g) => g.kind === 'decoder')!.entries.map((e) => e.label)).toEqual(['mwpm', 'uf']);
    const single = buildPlotStyle(grid(['mwpm']), 'dark', '#999').legend;
    expect(single.map((g) => g.kind)).toEqual(['distance']);
  });

  it('puts series without a distance last, labelled d = ?', () => {
    const { legend } = buildPlotStyle([mk('x', 5, 'm'), mk('x', null, 'm')], 'dark', '#999');
    expect(legend[0].entries.map((e) => e.label)).toEqual(['d = 5', 'd = ?']);
  });
});
