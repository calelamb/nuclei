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

/**
 * Physical error rate p for text: three significant figures, never a raw
 * float ("0.00035999999999999997" -> "3.6×10⁻⁴"). Values of 0.1 and above stay
 * plain ("0.15"); everything smaller is m×10ⁿ so a column of p lines up.
 */
export function formatNoise(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (p === 0) return '0';
  const abs = Math.abs(p);
  if (abs >= 0.1 && abs < 1000) return String(Number(p.toPrecision(3)));
  const [mant, exp] = p.toExponential(2).split('e');
  return `${String(Number(mant))}×${formatPow10(Number(exp))}`;
}

const sig3 = (x: number): string => String(Number(x.toPrecision(3)));

/**
 * A rate with its interval on one shared power of ten:
 * "9.55×10⁻³ [8.76, 10.4]×10⁻³". Rates of 0.1 and above stay plain, and a zero
 * best estimate keeps only the interval's upper bound.
 */
export function formatRateInterval(best: number, lo: number, hi: number): string {
  if (![best, lo, hi].every(Number.isFinite)) return '—';
  if (best >= 0.1) return `${sig3(best)} [${sig3(lo)}, ${sig3(hi)}]`;
  if (best === 0) return hi > 0 ? `0 [0, ${formatNoise(hi)}]` : '0';
  const exp = Math.floor(Math.log10(best));
  const m = (x: number): string => sig3(x / 10 ** exp);
  const power = formatPow10(exp);
  return `${m(best)}×${power} [${m(lo)}, ${m(hi)}]×${power}`;
}

/** One number convention for Λ on every surface: 3 significant figures, none after 100. */
export function formatLambda(x: number): string {
  return x >= 100 ? x.toFixed(0) : x.toPrecision(3);
}
