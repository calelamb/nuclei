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

/** Three significant figures with trailing zeros kept; rounding up into the next decade (999.7) drops to plain digits. */
const fixedSig3 = (x: number): string => {
  const text = x.toPrecision(3);
  return text.includes('e') ? String(Number(text)) : text;
};

/**
 * Tooltip and live-region rate: the same convention as the decoder table and
 * Λ readout (plain from 0.1, m×10ⁿ below), three significant figures with
 * trailing zeros kept so it matches the interval's precision.
 */
export function formatRatePrecise(x: number): string {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  const abs = Math.abs(x);
  if (abs >= 0.1 && abs < 1000) return fixedSig3(x);
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

/** Three significant figures with trailing zeros kept, so a column's cells share one precision. */
const sig3 = fixedSig3;

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

/** A whole number with thousands separators, so previews match the tables. */
export function formatCount(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—';
}

/** Round a float for export to 8 significant figures, dropping binary noise such as 0.010375899999999999. */
export function roundForExport(x: number): number {
  return Number.isFinite(x) ? Number(x.toPrecision(8)) : x;
}
