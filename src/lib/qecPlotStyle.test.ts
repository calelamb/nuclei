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

  it('gives each decoder its own dash when one experiment leaves the dash channel free, in plot and legend', () => {
    const { byKey, legend } = buildPlotStyle(grid(['mwpm', 'uf']), 'dark', '#999');
    expect(byKey.get('exp·d3·mwpm')!.dash).not.toBe(byKey.get('exp·d3·uf')!.dash);
    const entries = legend.find((g) => g.kind === 'decoder')!.entries;
    expect(entries.find((e) => e.id === 'mwpm')!.dash).toBe(byKey.get('exp·d3·mwpm')!.dash);
    expect(entries.find((e) => e.id === 'uf')!.dash).toBe(byKey.get('exp·d3·uf')!.dash);
  });

  it('keeps dash for experiments when several are plotted (decoders then rely on marker shape)', () => {
    const series = [...grid(['mwpm', 'uf'], 'a'), ...grid(['mwpm', 'uf'], 'b')];
    const { byKey, legend } = buildPlotStyle(series, 'dark', '#999');
    expect(byKey.get('a·d3·mwpm')!.dash).toBe(byKey.get('a·d3·uf')!.dash);
    expect(byKey.get('a·d3·mwpm')!.dash).not.toBe(byKey.get('b·d3·mwpm')!.dash);
    expect(legend.find((g) => g.kind === 'decoder')!.entries.every((e) => e.dash === undefined)).toBe(true);
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

function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

describe('distinguishability', () => {
  it.each(['dark', 'light'] as const)('first four %s colours differ by at least 40 degrees of hue', (mode) => {
    const hs = DISTANCE_PALETTE[mode].slice(0, 4).map(hue);
    for (let i = 0; i < hs.length; i++) {
      for (let j = i + 1; j < hs.length; j++) {
        const diff = Math.abs(hs[i] - hs[j]);
        expect(Math.min(diff, 360 - diff)).toBeGreaterThanOrEqual(40);
      }
    }
  });

  it('gives up to eight decoders each a different marker shape', () => {
    const decoders = Array.from({ length: 8 }, (_, i) => `dec${i}`);
    const { byKey } = buildPlotStyle(grid(decoders), 'dark', '#999');
    const shapes = new Set([...byKey.values()].map((s) => s.shape));
    expect(shapes.size).toBe(8);
  });
});
