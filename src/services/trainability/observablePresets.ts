/**
 * PRD 14 §5.3 — observable presets for the Trainability Lab target bar.
 *
 * Presets are sent to the kernel as `preset:<name>` strings (n-independent),
 * which keeps the field readable and lets the kernel canonicalize the text
 * (`TrainabilityLintSummary.observable`).
 */

export interface ObservablePreset {
  id: 'local_z' | 'global_z' | 'zz_chain' | 'tfim';
  label: string;
  /** What gets written into the observable field. */
  spec: string;
  description: string;
}

export const OBSERVABLE_PRESETS: readonly ObservablePreset[] = Object.freeze([
  {
    id: 'local_z',
    label: 'Local Z',
    spec: 'preset:local_z',
    description: '(1/n) Σ Zᵢ — a local cost; the barren-plateau-friendly baseline.',
  },
  {
    id: 'global_z',
    label: 'Global Z',
    spec: 'preset:global_z',
    description: 'Z⊗n — a global cost; concentrates even for shallow circuits.',
  },
  {
    id: 'zz_chain',
    label: 'ZZ chain',
    spec: 'preset:zz_chain',
    description: 'Σ ZᵢZᵢ₊₁ on an open chain — two-body local cost.',
  },
  {
    id: 'tfim',
    label: 'TFIM',
    spec: 'preset:tfim',
    description: '−Σ ZᵢZᵢ₊₁ − h Σ Xᵢ — transverse-field Ising chain (h = 1).',
  },
]);

export const DEFAULT_OBSERVABLE = 'preset:local_z';

/** Where the observable field's current text came from (UI-2). */
export type ObservableSource = 'default' | 'file' | 'user';

/**
 * What to send the kernel. An emptied field is an explicit override of the
 * file's declared observable, and falls back to the default preset rather
 * than to the empty string (which the kernel would read as "use the file's").
 */
export function effectiveObservable(observable: string): string {
  const trimmed = observable.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_OBSERVABLE;
}

/**
 * Reconcile the field with a fresh inspection. The user's own text always
 * wins; otherwise the file's `nuclei_observable` prefills the field, and the
 * default preset returns when the file stops declaring one.
 */
export function reconcileObservable(
  current: { observable: string; source: ObservableSource },
  declared: string | null | undefined,
): { observable: string; source: ObservableSource } {
  if (current.source === 'user') return current;
  const text = typeof declared === 'string' ? declared.trim() : '';
  if (text.length > 0) return { observable: text, source: 'file' };
  if (current.source === 'file') return { observable: DEFAULT_OBSERVABLE, source: 'default' };
  return current;
}

export function presetForSpec(spec: string): ObservablePreset | null {
  const normalized = spec.trim().toLowerCase();
  return OBSERVABLE_PRESETS.find((p) => p.spec === normalized) ?? null;
}

export interface ObservableParseError {
  message: string;
  /** 0-based column into the observable text, when the kernel reported one. */
  column: number | null;
}

/**
 * Extract the inline parse-error column from a kernel error. The kernel's
 * `ObservableError(message, column)` is surfaced either as a `column` field
 * on the error envelope or as "column N" inside the message.
 */
export function observableErrorFrom(error: { code?: string; message: string; column?: number }): ObservableParseError | null {
  const looksLikeObservable =
    (error.code ?? '').toLowerCase().includes('observable') || /observable/i.test(error.message);
  if (!looksLikeObservable) return null;
  if (typeof error.column === 'number' && Number.isFinite(error.column)) {
    return { message: error.message, column: Math.max(0, Math.floor(error.column)) };
  }
  const match = /column\s+(\d+)/i.exec(error.message);
  return { message: error.message, column: match ? Number(match[1]) : null };
}
