/**
 * Interval handling for kernel gradient / scaling payloads (CR-H1, UI-4).
 *
 * The kernel's `interval` field is an OBJECT `{kind, ...}`, never `[lo, hi]`.
 * The numbers always come from `variance_mean_ci95` / `variance_ci95`, and the
 * label from `interval_kind` (falling back to `interval.kind`, then to the
 * method: PPE intervals are truncation bounds, sampling intervals are
 * bootstrap CIs).
 */

import { isInterval } from '../../components/lab/chartUtils';
import type { IntervalKind, ResolvedMethod } from '../../types/trainability';

/** Anything that carries interval provenance (gradients result, scaling point). */
export interface IntervalSource {
  interval?: unknown;
  interval_kind?: IntervalKind | null;
  method?: ResolvedMethod | null;
}

/** A usable `[lo, hi]` pair, or null. Never throws on kernel-shaped garbage. */
export function validInterval(value: unknown): [number, number] | null {
  return isInterval(value) ? value : null;
}

function kindFromObject(interval: unknown): IntervalKind | null {
  if (interval && typeof interval === 'object' && !Array.isArray(interval)) {
    const kind = (interval as { kind?: unknown }).kind;
    if (kind === 'bootstrap' || kind === 'truncation') return kind;
  }
  return null;
}

export function intervalKindOf(source: IntervalSource): IntervalKind {
  return source.interval_kind ?? kindFromObject(source.interval) ?? (source.method === 'ppe' ? 'truncation' : 'bootstrap');
}

/** Noun phrase for the interval ("95% bootstrap CI" vs a rigorous bound). */
export function intervalNounForKind(kind: IntervalKind): string {
  return kind === 'truncation' ? 'rigorous truncation interval' : '95% bootstrap CI';
}

export function intervalNounOf(source: IntervalSource): string {
  return intervalNounForKind(intervalKindOf(source));
}

/** How the number was produced, in the words the UI and certificate share. */
export function methodDescription(method: ResolvedMethod | null | undefined): string {
  return method === 'ppe' ? 'exact Pauli propagation, no sampling' : 'Monte-Carlo sampling';
}

/** Interval width relative to the estimate, or null when either is unusable. */
export function relativeWidth(variance: number | null | undefined, interval: unknown): number | null {
  const ci = validInterval(interval);
  if (!ci || typeof variance !== 'number' || !(variance > 0)) return null;
  return (ci[1] - ci[0]) / variance;
}

/** True when a gradient/scaling value is a usable finite number. */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
