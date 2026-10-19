/**
 * Minimal line diff (LCS) used for the diff summary and the plain-text
 * fallback while Monaco's diff editor loads. Programs are small; very large
 * inputs degrade to a whole-file replace instead of an O(n·m) table.
 */

type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

const MAX_CELLS = 4_000_000;

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > MAX_CELLS) {
    return [...a.map((text) => ({ kind: 'del' as const, text })), ...b.map((text) => ({ kind: 'add' as const, text }))];
  }
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ kind: 'del', text: a[i] });
      i += 1;
    } else {
      out.push({ kind: 'add', text: b[j] });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) out.push({ kind: 'del', text: a[i] });
  for (; j < b.length; j += 1) out.push({ kind: 'add', text: b[j] });
  return out;
}

export function diffStats(lines: readonly DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.kind === 'add').length,
    removed: lines.filter((l) => l.kind === 'del').length,
  };
}

/** Unified-style text with `+`/`-`/space prefixes. */
export function renderDiffText(lines: readonly DiffLine[]): string {
  return lines.map((l) => `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '} ${l.text}`).join('\n');
}
