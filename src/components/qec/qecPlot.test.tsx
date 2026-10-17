// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ThresholdPanel } from './ThresholdPanel';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import type { QecCampaignStatsRow } from '../../types/qec';

const downloadCsv = vi.fn();
const downloadSvg = vi.fn();
vi.mock('../../services/experimentExport', () => ({
  downloadCsv: (...a: unknown[]) => downloadCsv(...a),
  downloadSvg: (...a: unknown[]) => downloadSvg(...a),
}));

interface RowOpts { d: number; p: number; errors: number; decoder?: string; id?: string; r?: number; label?: string }

const row = (o: RowOpts): QecCampaignStatsRow => ({
  shots: 100000, errors: o.errors, discards: 0, seconds: 1, decoder: o.decoder ?? 'pymatching',
  strong_id: o.id ?? `${o.decoder ?? 'pymatching'}-${o.d}-${o.p}-${o.errors}`,
  json_metadata: { d: o.d, p: o.p, r: o.r ?? o.d, label: o.label ?? 'x' }, custom_counts: {},
});

function load(rows: QecCampaignStatsRow[]) {
  const map: Record<string, QecCampaignStatsRow> = {};
  for (const r of rows) map[r.strong_id] = r;
  useQecCampaignStore.setState({ rowsByStrongId: map, statsCsv: '', running: false });
}

const grid = (decoders: string[]) => decoders.flatMap((decoder) =>
  [3, 5, 7, 9].flatMap((d) => [0.001, 0.002, 0.004].map((p) => row({ d, p, decoder, errors: Math.round(20000 * p * 100 / d ** 1.5) + 5 }))));

beforeEach(() => { downloadCsv.mockClear(); downloadSvg.mockClear(); useQecCampaignStore.getState().reset(); });
afterEach(() => cleanup());

describe('plot legend', () => {
  it('lists every distance and every decoder in the figure', () => {
    load(grid(['mwpm', 'uf']));
    const { getByTestId } = render(<ThresholdPanel />);
    const legend = getByTestId('qec-svg-legend').textContent!;
    for (const d of [3, 5, 7, 9]) expect(legend).toContain(`d = ${d}`);
    expect(legend).toContain('mwpm');
    expect(legend).toContain('uf');
  });

  it('gives each distance a distinct colour and each decoder a distinct marker shape', () => {
    load(grid(['mwpm', 'uf']));
    const { container } = render(<ThresholdPanel />);
    const colors = new Set([...container.querySelectorAll('polyline')].map((l) => l.getAttribute('stroke')));
    expect(colors.size).toBe(4);
    const shapesFor = (key: string) => container.querySelector(`g[data-series$="${key}"]`)!.innerHTML;
    expect(shapesFor('d3·mwpm')).toContain('<circle');
    expect(shapesFor('d3·uf')).toContain('<rect');
  });

  it('omits the decoder group for a single decoder', () => {
    load(grid(['mwpm']));
    const { getByTestId } = render(<ThresholdPanel />);
    expect(getByTestId('qec-svg-legend').textContent).not.toContain('Decoder');
  });
});

describe('axes and typography', () => {
  it('labels ticks as superscripted powers of ten at fixed pixel sizes', () => {
    load(grid(['mwpm']));
    const { container } = render(<ThresholdPanel />);
    const ticks = [...container.querySelectorAll('svg text')].filter((t) => /^10[⁻⁰¹²³⁴-⁹]+$/.test(t.textContent ?? ''));
    expect(ticks.length).toBeGreaterThan(1);
    for (const t of ticks) expect(t.getAttribute('font-size')).toBe('11');
    const svg = container.querySelector('svg[role="img"]')!;
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}`);
  });
});

describe('non-positive coordinates', () => {
  it('never emits NaN or Infinity, and says which points were not drawn', () => {
    load([...grid(['mwpm']), row({ d: 3, p: 0, errors: 40 }), row({ d: 5, p: 0, errors: 10 })]);
    const { container, getByText } = render(<ThresholdPanel />);
    expect(container.querySelector('svg')!.outerHTML).not.toMatch(/NaN|Infinity/);
    expect(getByText('2 points not drawn: p = 0 on a log axis')).toBeTruthy();
  });

  it('draws zero-error points as hollow upper-bound markers, not at an invented value', () => {
    load([...grid(['mwpm']), row({ d: 9, p: 0.0005, errors: 0 })]);
    const { container, getByText } = render(<ThresholdPanel />);
    expect(getByText('1 zero-error point drawn at its upper bound (hollow ▽)')).toBeTruthy();
    const hollow = [...container.querySelectorAll('g[data-series] polygon')].filter((p) => p.getAttribute('fill') !== p.getAttribute('stroke'));
    expect(hollow).toHaveLength(1);
    expect(container.querySelector('svg')!.outerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('shows an explicit empty state when every point has p = 0', () => {
    load([row({ d: 3, p: 0, errors: 40 }), row({ d: 5, p: 0, errors: 10 })]);
    const { getByText, container } = render(<ThresholdPanel />);
    expect(getByText('No plottable points')).toBeTruthy();
    expect(container.textContent).toMatch(/p = 0/);
  });
});

describe('Λ readout caveats', () => {
  it('warns when distinct tasks collide at a distance', () => {
    load([
      row({ d: 3, p: 0.004, errors: 900, id: 'a' }), row({ d: 5, p: 0.004, errors: 400, id: 'b' }),
      row({ d: 7, p: 0.004, errors: 200, id: 'c' }), row({ d: 7, p: 0.004, errors: 600, id: 'c2' }),
    ]);
    const { container } = render(<ThresholdPanel />);
    expect(container.querySelector('[aria-label="Error suppression factor Λ"]')!.textContent)
      .toMatch(/distinct tasks collide at d 7, fitted as replicates/);
  });

  it('warns when rounds vary with distance in the per-shot view only', () => {
    load([3, 5, 7].map((d) => row({ d, p: 0.004, errors: 900 / (d - 1), r: d })));
    const { container, getByRole } = render(<ThresholdPanel />);
    const readout = () => container.querySelector('[aria-label="Error suppression factor Λ"]')!.textContent!;
    expect(readout()).not.toMatch(/rounds vary with d/);
    fireEvent.click(getByRole('button', { name: 'Per shot' }));
    expect(readout()).toMatch(/rounds vary with d, confounding this per-shot Λ/);
  });

  it('still shows the fit-quality warnings', () => {
    load([[3, 1000], [5, 1100], [7, 1050]].map(([d, errors]) => row({ d, p: 0.004, errors, r: 3 })));
    const { container } = render(<ThresholdPanel />);
    expect(container.textContent).toMatch(/do not decrease with distance/);
  });
});

describe('point tooltip', () => {
  it('shows d, p, decoder, rate, interval, errors and kept shots on hover', () => {
    load(grid(['mwpm']));
    const { container, queryByRole, getByRole } = render(<ThresholdPanel />);
    expect(queryByRole('tooltip')).toBeNull();
    const marker = container.querySelector('g[data-series] circle')!;
    const overlay = [...container.querySelectorAll('svg rect')].find((r) => r.getAttribute('fill') === 'transparent')!;
    const [cx, cy] = [Number(marker.getAttribute('cx')), Number(marker.getAttribute('cy'))];
    fireEvent.mouseMove(overlay, {
      clientX: cx - Number(overlay.getAttribute('x')), clientY: cy - Number(overlay.getAttribute('y')),
    });
    const text = getByRole('tooltip').textContent!;
    expect(text).toMatch(/d = 3/);
    expect(text).toMatch(/mwpm/);
    expect(text).toMatch(/rate per round/);
    expect(text).toMatch(/interval: .* to /);
    expect(text).toMatch(/errors in 100,000 kept shots/);
    fireEvent.mouseLeave(overlay);
    expect(queryByRole('tooltip')).toBeNull();
  });
});

describe('exported figure', () => {
  const exportOf = (c: ReturnType<typeof render>) => {
    fireEvent.click(c.getByRole('button', { name: 'Export plot as SVG' }));
    return downloadSvg.mock.calls.at(-1)![0] as SVGSVGElement;
  };

  it('matches the panel: legend, superscript ticks, fixed font sizes, background, no scaling', () => {
    load(grid(['mwpm', 'uf']));
    const svg = exportOf(render(<ThresholdPanel />));
    expect(svg.getAttribute('width')).toBe('900');
    expect(svg.getAttribute('style')).toBeNull();
    expect(svg.querySelector('[data-testid="qec-svg-legend"]')!.textContent).toMatch(/d = 3.*mwpm/);
    const ticks = [...svg.querySelectorAll('text')].filter((t) => /^10[⁻⁰¹²³⁴-⁹]+$/.test(t.textContent ?? ''));
    expect(ticks.length).toBeGreaterThan(1);
    for (const t of ticks) expect(t.getAttribute('font-size')).toBe('11');
    expect(svg.querySelector('rect[data-export-bg]')!.getAttribute('fill')).toBeTruthy();
    expect(svg.querySelector('metadata')!.textContent).toContain('"units"');
    expect(svg.outerHTML).not.toMatch(/NaN|Infinity|var\(--/);
  });

  it('carries the omission notes and the Λ footer', () => {
    load([...grid(['mwpm']), row({ d: 3, p: 0, errors: 3 })]);
    const svg = exportOf(render(<ThresholdPanel />));
    expect(svg.textContent).toContain('1 point not drawn: p = 0 on a log axis');
    expect(svg.textContent).toMatch(/Whiskers: sinter likelihood ratio/);
    expect(svg.querySelector('desc')!.textContent).toMatch(/Λ = /);
  });
});
