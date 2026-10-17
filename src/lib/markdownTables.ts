/**
 * Minimal GFM-style table support for lesson and challenge markdown.
 *
 * react-markdown renders no tables without remark-gfm, and a stock GFM parser
 * would also split `|00>` inside code spans (this content is full of kets), so
 * tables are parsed here: pipes inside backtick spans are cell content.
 */
export type TableAlign = 'left' | 'center' | 'right' | null;

export interface TableBlock {
  type: 'table';
  header: string[];
  align: TableAlign[];
  rows: string[][];
}

export interface MarkdownBlock {
  type: 'markdown';
  text: string;
}

export type ContentSegment = TableBlock | MarkdownBlock;

const SEPARATOR_CELL = /^:?-{1,}:?$/;

export function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inCode = false;
  const trimmed = line.trim();
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') { current += '|'; i += 1; continue; }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) { cells.push(current); current = ''; continue; }
    current += ch;
  }
  cells.push(current);
  const cleaned = cells.map((c) => c.trim());
  if (trimmed.startsWith('|')) cleaned.shift();
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) cleaned.pop();
  return cleaned;
}

function isSeparatorRow(line: string): boolean {
  if (!line.includes('-')) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((c) => SEPARATOR_CELL.test(c));
}

function alignOf(cell: string): TableAlign {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return left ? 'left' : null;
}

function padRow(cells: string[], width: number): string[] {
  return Array.from({ length: width }, (_, i) => cells[i] ?? '');
}

export function splitMarkdownTables(markdown: string): ContentSegment[] {
  const lines = markdown.split('\n');
  const segments: ContentSegment[] = [];
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    if (buffer.length > 0) segments.push({ type: 'markdown', text: buffer.join('\n') });
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) inFence = !inFence;
    const next = lines[i + 1];
    if (!inFence && line.includes('|') && next !== undefined && isSeparatorRow(next)) {
      const header = splitTableRow(line);
      const align = splitTableRow(next).map(alignOf);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') {
        rows.push(padRow(splitTableRow(lines[j]), header.length));
        j += 1;
      }
      flush();
      segments.push({ type: 'table', header, align: padAlign(align, header.length), rows });
      i = j - 1;
      continue;
    }
    buffer.push(line);
  }
  flush();
  return segments;
}

function padAlign(align: TableAlign[], width: number): TableAlign[] {
  return Array.from({ length: width }, (_, i) => align[i] ?? null);
}
