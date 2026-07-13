/**
 * PRD 09 Phase E (E3) — CSV/SVG export for the Compare view, the sweep
 * plot, and the runs table. `toCsv` / `escapeCsvCell` / `svgToDownloadableString`
 * are pure (no DOM), so the escaping and serialization logic is fully unit
 * tested; `downloadCsv` / `downloadSvg` are the thin, untested DOM wiring
 * behind each "Export" button.
 */

/**
 * Escape a single CSV cell per RFC 4180: quote the value if it contains a
 * comma, a double quote, or a line break, doubling any embedded quotes.
 * Plain cells are left untouched.
 */
export function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/**
 * Serialize an array of plain row objects into CRLF-joined CSV text, in the
 * given column order. Missing keys render as an empty cell. Pure — callers
 * (runs table, compare metrics table, sweep-series export) build the
 * `rows`/`columns` shape from whatever domain data they have; this function
 * only knows about cells and escaping.
 */
export function toCsv(rows: ReadonlyArray<Record<string, unknown>>, columns: readonly string[]): string {
  const header = columns.map(escapeCsvCell).join(',');
  const body = rows.map((row) => columns.map((col) => escapeCsvCell(formatCsvValue(row[col]))).join(','));
  return [header, ...body].join('\r\n');
}

/** Trigger a browser download of CSV text. */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Serialize a rendered `<svg>` element into a standalone, downloadable XML
 * document string (adds the XML prolog when the serializer doesn't already
 * include one).
 */
export function svgToDownloadableString(svg: SVGElement): string {
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svg);
  if (!/^<\?xml/.test(source)) {
    source = `<?xml version="1.0" standalone="no"?>\r\n${source}`;
  }
  return source;
}

/** Trigger a browser download of a rendered SVG element. */
export function downloadSvg(svg: SVGElement, filename: string): void {
  const source = svgToDownloadableString(svg);
  const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Trigger a browser download of a value serialized as pretty JSON (used by
 * the Resource Estimator's "Export JSON" — the estimator's full document). */
export function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
