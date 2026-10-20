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

/** CIEDE2000 colour difference between two #rrggbb colours (Sharma, Wu & Dalal reference formulation). */
function deltaE2000(a: string, b: string): number {
  const lab = (hex: string): [number, number, number] => {
    const lin = (i: number) => {
      const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const [r, g, bl] = [lin(0), lin(1), lin(2)];
    const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * bl) / 0.95047;
    const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * bl;
    const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * bl) / 1.08883;
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const rad = (d: number) => (d * Math.PI) / 180;
  const deg = (r: number) => ((r * 180) / Math.PI + 360) % 360;
  const [L1, a1, b1] = lab(a);
  const [L2, a2, b2] = lab(b);
  const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const [ap1, ap2] = [a1 * (1 + G), a2 * (1 + G)];
  const [C1, C2] = [Math.hypot(ap1, b1), Math.hypot(ap2, b2)];
  const [h1, h2] = [C1 === 0 ? 0 : deg(Math.atan2(b1, ap1)), C2 === 0 ? 0 : deg(Math.atan2(b2, ap2))];
  const dL = L2 - L1;
  const dC = C2 - C1;
  let dh = h2 - h1;
  if (C1 * C2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin(rad(dh / 2));
  const Lb = (L1 + L2) / 2;
  const Cb = (C1 + C2) / 2;
  let hb = h1 + h2;
  if (C1 * C2 !== 0) hb = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2;
  const T = 1 - 0.17 * Math.cos(rad(hb - 30)) + 0.24 * Math.cos(rad(2 * hb)) + 0.32 * Math.cos(rad(3 * hb + 6)) - 0.2 * Math.cos(rad(4 * hb - 63));
  const dTheta = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cb;
  const Sh = 1 + 0.015 * Cb * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

describe('palette separation (qec-r-30)', () => {
  it.each(['dark', 'light'] as const)('keeps every pair among the first 6 %s colours at least 15 delta-E apart', (mode) => {
    const colors = DISTANCE_PALETTE[mode].slice(0, 6);
    for (let i = 0; i < colors.length; i += 1) {
      for (let j = i + 1; j < colors.length; j += 1) {
        expect(deltaE2000(colors[i], colors[j]), `${colors[i]} vs ${colors[j]}`).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it.each(['dark', 'light'] as const)('reserves purple for Dirac: no purple or fuchsia slot in %s mode', (mode) => {
    for (const c of DISTANCE_PALETTE[mode]) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      const purple = b >= r && r > g + 20;
      expect(purple, c).toBe(false);
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
