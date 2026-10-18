/**
 * PRD 14 — Quantum AI Lab chart helpers (pure; no React). Formatting,
 * color roles (lab.css CSS variables) and domain padding shared by every
 * Lab chart.
 */

// ── Formatting ────────────────────────────────────────────────────────────

const SUPERSCRIPT: Record<string, string> = {
  '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};

function superscript(n: number): string {
  return String(n)
    .split('')
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join('');
}

/**
 * Scientific-friendly number formatting: fixed notation inside
 * [1e-3, 1e5), otherwise `m×10ⁿ`. `digits` = significant digits.
 */
export function formatSci(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e-3 && abs < 1e5) {
    const fixed = Number(value.toPrecision(digits));
    const text = Math.abs(fixed) >= 1000 ? fixed.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(fixed);
    return text.replace('-', '−');
  }
  const exponent = Math.floor(Math.log10(abs));
  const mantissa = value / 10 ** exponent;
  const m = Number(mantissa.toPrecision(digits));
  // Rounding can carry into the next decade (9.996 → 10.0).
  if (Math.abs(m) >= 10) return formatSci(value >= 0 ? 10 ** (exponent + 1) : -(10 ** (exponent + 1)), digits);
  const mText = String(m).replace('-', '−');
  return `${mText === '1' ? '' : `${mText}×`}10${superscript(exponent)}`;
}

/** Compact tick formatting for axes (fewer digits than formatSci). */
export function formatTick(value: number, log = false): string {
  if (log) {
    if (value <= 0) return '';
    const exponent = Math.log10(value);
    if (Math.abs(exponent - Math.round(exponent)) < 1e-9) return `10${superscript(Math.round(exponent))}`;
    return '';
  }
  return formatSci(value, 3);
}

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

/** Shared "no value" glyph, so a missing number never prints `null`/`NaN`. */
export const NO_VALUE = '—';

/** True for a two-element array of finite numbers (a usable `[lo, hi]`). */
export function isInterval(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/** `[lo, hi]`, or an em dash when the interval is missing or malformed. */
export function formatInterval(ci: unknown, digits = 2): string {
  if (!isInterval(ci)) return NO_VALUE;
  return `[${formatSci(ci[0], digits)}, ${formatSci(ci[1], digits)}]`;
}

/** An exact integer with thousands separators (4095 stays 4,095, never 4,100). */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return Math.round(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Guard for interpolated strings: null, undefined and NaN become an em dash. */
export function formatValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return NO_VALUE;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : NO_VALUE;
  return value.length > 0 ? value : NO_VALUE;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  if (m < 60) return `${m}m ${String(rem).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

// ── Color roles ───────────────────────────────────────────────────────────

export const SEQ_STEPS = 9;

/** Discrete sequential color (CSS var) for t ∈ [0, 1]. */
export function seqColor(t: number): string {
  const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  return `var(--lab-seq-${Math.round(clamped * (SEQ_STEPS - 1))})`;
}

/** Label ink (CSS var) to draw on `seqColor(t)`: black or white by luminance, >= 4.5:1. */
export function seqInk(t: number): string {
  const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  return `var(--lab-seq-ink-${Math.round(clamped * (SEQ_STEPS - 1))})`;
}

/**
 * Categorical color by FIXED slot (identity, never rank). Slots past 8 fold
 * into a neutral "other" ink rather than generating a new hue.
 */
export function catColor(slot: number): string {
  if (slot < 0 || slot >= 8) return 'var(--color-text-tertiary)';
  return `var(--lab-cat-${slot + 1})`;
}

/**
 * Read the live sequential ramp (for canvas rendering) from an element inside
 * `.lab`. lab.css is the single source of the ramp: when it cannot be read
 * (no stylesheet, a non-browser environment) this returns an empty ramp and
 * the caller skips drawing rather than painting stale hard-coded colors.
 */
export function readSeqRamp(el: Element | null): string[] {
  if (!el || typeof getComputedStyle === 'undefined') return [];
  const style = getComputedStyle(el);
  const ramp = Array.from({ length: SEQ_STEPS }, (_, i) => style.getPropertyValue(`--lab-seq-${i}`).trim());
  return ramp.every((c) => /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c)) ? ramp : [];
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Continuous interpolation along a hex ramp → `rgb(r,g,b)` for canvas. */
export function interpolateRamp(ramp: string[], t: number): [number, number, number] {
  const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
  const pos = clamped * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(pos));
  const f = pos - i;
  const a = hexToRgb(ramp[i]);
  const b = hexToRgb(ramp[i + 1]);
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** Pad a [min, max] extent; handles degenerate and log domains. */
export function paddedDomain(values: number[], { log = false, pad = 0.06 }: { log?: boolean; pad?: number } = {}): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v) && (!log || v > 0));
  if (finite.length === 0) return log ? [1e-6, 1] : [0, 1];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (log) {
    const llo = Math.log10(lo);
    const lhi = Math.log10(hi);
    const span = Math.max(0.5, lhi - llo);
    return [Number(`1e${Math.floor(llo - span * pad)}`), Number(`1e${Math.ceil(lhi + span * pad)}`)];
  }
  if (lo === hi) {
    const d = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= d;
    hi += d;
  }
  const span = hi - lo;
  return [lo - span * pad, hi + span * pad];
}
