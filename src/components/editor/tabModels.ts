/**
 * Which previously-open tab paths are no longer open — i.e. whose Monaco models
 * should be disposed. Pure so the per-tab-model lifecycle (dev tools Phase 4 /
 * P4.1) is testable without a live editor.
 */
export function pathsRemoved(prev: Iterable<string>, next: Set<string>): string[] {
  const removed: string[] = [];
  for (const p of prev) {
    if (!next.has(p)) removed.push(p);
  }
  return removed;
}
