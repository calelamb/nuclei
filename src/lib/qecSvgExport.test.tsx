// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildPlotModel } from './qecPlotModel';
import { renderFigureSvg, PRINT_COLORS } from './qecSvgExport';
import { figureFooterLines } from './qecFigureText';
import { likelihoodSeries, lambdaEstimates } from './qecFit';
import type { QecCampaignStatsRow } from '../types/qec';

const rows: QecCampaignStatsRow[] = [3, 5, 7].flatMap((d, i) => [0.001, 0.002].map((p) => ({
  strong_id: `${d}-${p}`, decoder: 'pm', shots: 100000, errors: Math.round(1000 * p * 1000 / 3 ** i), discards: 0,
  seconds: 1, custom_counts: {}, json_metadata: { d, p, r: d },
})));

describe('SVG export (qec-05)', () => {
  const { series } = likelihoodSeries(rows, { units: 'per_round' });
  const model = buildPlotModel(series, 'light', PRINT_COLORS.textMuted, 'per_round')!;
  const svg = renderFigureSvg({ model, footerLines: figureFooterLines(lambdaEstimates(rows, { units: 'per_round' })) });

  it('paints a white page with dark text, whatever the app theme', () => {
    expect(svg.querySelector('[data-export-bg]')?.getAttribute('fill')).toBe('#FFFFFF');
    const fills = [...svg.querySelectorAll('text')].map((t) => t.getAttribute('fill'));
    const allowed = [PRINT_COLORS.text, PRINT_COLORS.textMuted];
    expect(fills.every((f) => f !== null && allowed.includes(f))).toBe(true);
  });

  it('keeps the footer to one short line', () => {
    const footer = svg.querySelectorAll('[data-testid="qec-svg-footer"] text');
    expect(footer).toHaveLength(1);
    expect(footer[0].textContent).toMatch(/^Whiskers: sinter/);
    expect(svg.textContent).not.toMatch(/Λ = /);
  });
});
