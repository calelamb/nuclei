const DENOMINATORS = [1, 2, 3, 4, 6, 8, 12];
const EPSILON = 1e-6;

/** Format a rotation angle as a multiple of pi when it is one (π/2, 3π/4), else a short decimal. */
export function formatAngle(radians: number): string {
  if (!Number.isFinite(radians)) return String(radians);
  if (Math.abs(radians) < EPSILON) return '0';
  const ratio = radians / Math.PI;
  for (const d of DENOMINATORS) {
    const n = Math.round(ratio * d);
    if (n !== 0 && Math.abs(ratio * d - n) < EPSILON) {
      const sign = n < 0 ? '-' : '';
      const abs = Math.abs(n);
      const numerator = abs === 1 ? 'π' : `${abs}π`;
      return d === 1 ? `${sign}${numerator}` : `${sign}${numerator}/${d}`;
    }
  }
  return Number(radians.toFixed(2)).toString();
}

/** The sub-label under a gate box; empty when the gate has no parameters. */
export function formatGateParams(params: readonly number[]): string {
  return params.map(formatAngle).join(', ');
}
