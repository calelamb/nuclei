/** Small number formatters shared by the Discovery Engine UI. */

/** 1234 → "1.2k", 1_500_000 → "1.5M"; small counts stay exact. */
export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs < 1000) return String(Math.round(value));
  if (abs < 1_000_000) return `${(value / 1000).toFixed(abs < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function signed(value: number, formatter: (v: number) => string): string {
  return `${value >= 0 ? '+' : '−'}${formatter(Math.abs(value))}`;
}

/** `20261018-141530-a1b2` → `2026-10-18 14:15`. */
export function runTimeLabel(runId: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(runId);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : runId;
}

export const EVALUATOR_TITLE = {
  qec_memory: 'QEC memory',
  state_synthesis: 'State synthesis',
  vqe_ground_state: 'VQE ground state',
  trainability_frontier: 'Trainability frontier',
} as const;

export function mutatorLabel(kind: 'llm' | 'ast' | 'hybrid', breadth: string, depth: string): string {
  if (kind === 'ast') return 'AST mutator';
  return `${kind === 'llm' ? 'LLM' : 'Hybrid'} · ${breadth}/${depth}`;
}
