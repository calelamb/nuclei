import type { ExperimentSpec, Sweep, SweepParam } from '../../types/experiment';

/**
 * PRD 09 Phase D (D1b) — pure helpers for `NewExperimentForm`, kept out of
 * the component so the tricky bits (slugging a filename, building the sweep
 * object, ordering the serialized YAML) are unit-testable without React.
 */

export interface SweepRowState {
  id: string;
  name: string;
  mode: 'range' | 'values';
  rangeStart: string;
  rangeStop: string;
  rangeStep: string;
  valuesText: string;
}

export function newSweepRow(id: string): SweepRowState {
  return { id, name: '', mode: 'range', rangeStart: '0', rangeStop: '1', rangeStep: '0.1', valuesText: '' };
}

/** Convert the form's sweep rows into the `Sweep` shape the schema expects.
 * Rows with a blank name are dropped (they're just an in-progress add). */
export function buildSweepFromRows(rows: readonly SweepRowState[]): Sweep | undefined {
  const named = rows.filter((r) => r.name.trim().length > 0);
  if (named.length === 0) return undefined;

  const sweep: Record<string, SweepParam> = {};
  for (const row of named) {
    const name = row.name.trim();
    if (row.mode === 'range') {
      sweep[name] = {
        range: [Number(row.rangeStart), Number(row.rangeStop), Number(row.rangeStep)],
      };
    } else {
      const values = row.valuesText
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
        .map(Number);
      sweep[name] = { values };
    }
  }
  return sweep;
}

/** Reverse of `buildSweepFromRows`, for populating the form from an existing
 * spec (edit / re-sync-on-file-change). */
export function sweepToRows(sweep: Sweep | undefined, nextId: () => string): SweepRowState[] {
  if (!sweep) return [];
  return Object.entries(sweep).map(([name, param]) => {
    const row = newSweepRow(nextId());
    row.name = name;
    if ('range' in param) {
      row.mode = 'range';
      row.rangeStart = String(param.range[0]);
      row.rangeStop = String(param.range[1]);
      row.rangeStep = String(param.range[2]);
    } else {
      row.mode = 'values';
      row.valuesText = param.values.join(', ');
    }
    return row;
  });
}

/** Filesystem-safe filename stem from a display name — lowercase, spaces
 * and anything not `[a-z0-9-]` collapse to single hyphens. */
export function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'experiment';
}

/**
 * Ordered plain object matching the documented YAML key order (schema,
 * name, entry, language, backend, shots, seed, sweep, notes) — `yaml`'s
 * `stringify` preserves insertion order for string keys.
 */
export function specToYamlDoc(spec: ExperimentSpec): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    schema: spec.schema,
    name: spec.name,
    entry: spec.entry,
    language: spec.language,
    backend: { provider: spec.backend.provider, target: spec.backend.target },
    shots: spec.shots,
    seed: spec.seed,
  };
  if (spec.sweep) doc.sweep = spec.sweep;
  if (spec.notes) doc.notes = spec.notes;
  return doc;
}

export interface EntryListingPort {
  listDirectory(path: string): Promise<Array<{ name: string; path: string; kind: 'file' | 'directory' }> | null>;
}

const EXCLUDED_DIR_NAMES = new Set([
  'node_modules', '.git', 'experiments', 'dist', 'dist-web', '__pycache__', '.venv', 'venv',
]);
const ENTRY_FILE_RE = /\.(py|qs)$/i;
const MAX_DISCOVERY_DEPTH = 4;

/** Shallow, depth-limited scan of the project for candidate entry files
 * (`.py` / `.qs`), skipping the usual noisy/irrelevant directories. Used to
 * populate the entry-file datalist — never throws; a listing failure just
 * yields fewer candidates (the free-text input is always the fallback). */
export async function discoverEntryFiles(
  port: EntryListingPort,
  projectRoot: string,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string, relPrefix: string, depth: number): Promise<void> {
    if (depth > MAX_DISCOVERY_DEPTH) return;
    let entries;
    try {
      entries = await port.listDirectory(dir);
    } catch {
      return;
    }
    if (!entries) return;
    for (const entry of entries) {
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        if (EXCLUDED_DIR_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(entry.path, relPath, depth + 1);
      } else if (ENTRY_FILE_RE.test(entry.name)) {
        results.push(relPath);
      }
    }
  }

  await walk(projectRoot, '', 0);
  return results.sort();
}
