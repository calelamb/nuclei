/** Number formatting for the QEC plot: superscript powers of ten and compact rates. */

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
};

export const SUPERSCRIPT_CHARS = '⁰¹²³⁴⁵⁶⁷⁸⁹⁻';

export function toSuperscript(n: number): string {
  return [...String(Math.trunc(n))].map((ch) => SUPERSCRIPT[ch] ?? ch).join('');
}

export function formatPow10(exp: number): string {
  return `10${toSuperscript(exp)}`;
}

/** "2×10⁻³", or plain "10⁻³" when the mantissa is 1. */
export function formatMultiplierTick(mantissa: number, exp: number): string {
  return mantissa === 1 ? formatPow10(exp) : `${mantissa}×${formatPow10(exp)}`;
}

/** Compact rate: decimals for 0.01 <= x < 1000, otherwise m×10ⁿ with at most one decimal. */
export function formatSci(x: number): string {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  const abs = Math.abs(x);
  if (abs >= 0.01 && abs < 1000) return String(Number(x.toPrecision(3)));
  const [mant, exp] = x.toExponential(1).split('e');
  const trimmed = mant.endsWith('.0') ? mant.slice(0, -2) : mant;
  return `${trimmed}×${formatPow10(Number(exp))}`;
}

/** Tooltip rate: three significant figures, trailing zeros kept so it matches the interval's precision. */
export function formatRatePrecise(x: number): string {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  const abs = Math.abs(x);
  if (abs >= 0.01 && abs < 1000) return String(Number(x.toPrecision(3)));
  const [mant, exp] = x.toExponential(2).split('e');
  return `${mant}×${formatPow10(Number(exp))}`;
}
