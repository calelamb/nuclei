import { describe, expect, it } from 'vitest';
import { distinctLayers, exponentialBand, exponentialCurve, meanOf, powerLawCurve } from './tabs/scalingMath';
import { scalingFixture } from '../../services/trainability/fixtures';

const fit = scalingFixture.fits[0];

describe('scaling curves', () => {
  it('evaluates Var = 2^(log2_intercept − β n)', () => {
    const curve = exponentialCurve(fit.exponential!, 2, 8);
    expect(curve[0].n).toBe(2);
    expect(curve[0].value).toBeCloseTo(2 ** (-1.1 - 0.93 * 2), 10);
    expect(curve.at(-1)!.value).toBeCloseTo(2 ** (-1.1 - 0.93 * 8), 10);
  });

  it('opens the CI band away from the centroid and brackets the fit', () => {
    const centroid = meanOf([2, 3, 4, 5, 6, 7, 8]);
    const { lower, upper } = exponentialBand(fit.exponential!, centroid, 2, 8);
    const mid = exponentialCurve(fit.exponential!, 2, 8);
    lower.forEach((p, i) => {
      expect(p.value).toBeLessThanOrEqual(mid[i].value * (1 + 1e-9));
      expect(upper[i].value).toBeGreaterThanOrEqual(mid[i].value * (1 - 1e-9));
    });
    const edgeWidth = upper[0].value / lower[0].value;
    const centerWidth = upper[Math.floor(upper.length / 2)].value / lower[Math.floor(lower.length / 2)].value;
    expect(edgeWidth).toBeGreaterThan(centerWidth);
  });

  it('anchors the power law on the data log-mean', () => {
    const points = scalingFixture.points.slice(0, 7);
    const curve = powerLawCurve(fit.power_law!, points, 2, 8);
    expect(curve.length).toBeGreaterThan(10);
    expect(curve[0].value).toBeGreaterThan(curve.at(-1)!.value);
    expect(powerLawCurve(fit.power_law!, [], 2, 8)).toEqual([]);
  });

  it('lists distinct layer counts sorted', () => {
    expect(distinctLayers({ ...scalingFixture, points: [{ ...scalingFixture.points[0], n_layers: 8 }, ...scalingFixture.points] })).toEqual([4, 8]);
  });
});
