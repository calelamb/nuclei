import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * PRD 09 Phase C — the Experiment object.
 *
 * Pure, dependency-light, exhaustively tested. This module owns:
 *  - the `*.experiment.yaml` v1 schema (zod over `yaml`-parsed text),
 *  - deterministic grid expansion of a sweep into concrete points,
 *  - the run `manifest.json` / in-memory `RunRecord` schemas,
 *  - pure derived-metric math (`counts_entropy`, `top_state_probability`).
 *
 * NO file or kernel I/O lives here. The store and runner inject those.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap on total sweep points in v1 (PRD "grid size … hard-capped at 500"). */
export const MAX_GRID_POINTS = 500;

/**
 * Epsilon added to the step count of a numpy.arange-style range so that a
 * `stop` which is an exact multiple of `step` lands INSIDE the range
 * (inclusive-ish, per the PRD) instead of being dropped by float error.
 * Applied to the (stop-start)/step quotient, so it is unit-free.
 */
const RANGE_EPSILON = 1e-9;

// Python soft keywords are fine as identifiers; hard keywords are not. This
// is the CPython 3.12 `keyword.kwlist`. Param names must be valid Python
// identifiers because they are injected into the exec namespace.
const PYTHON_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidParamName(name: string): boolean {
  return IDENTIFIER_RE.test(name) && !PYTHON_KEYWORDS.has(name);
}

// ---------------------------------------------------------------------------
// Sweep + spec schemas
// ---------------------------------------------------------------------------

export type KernelLanguage = 'python' | 'qsharp';

/** One swept parameter: either a numeric range or an explicit value list. */
export const sweepParamSchema = z.union([
  z.strictObject({ range: z.tuple([z.number(), z.number(), z.number()]) }),
  z.strictObject({ values: z.array(z.number()).min(1) }),
]);
export type SweepParam = z.infer<typeof sweepParamSchema>;

export const sweepSchema = z.record(z.string(), sweepParamSchema);
export type Sweep = z.infer<typeof sweepSchema>;

export const backendSchema = z.strictObject({
  provider: z.string().min(1),
  target: z.string().min(1),
});
export type BackendRef = z.infer<typeof backendSchema>;

/**
 * The validated experiment spec. `name` and `language` always resolve to a
 * concrete value (defaults are applied before validation), so downstream code
 * never re-derives them.
 */
export const experimentSpecSchema = z.strictObject({
  schema: z.literal(1),
  name: z.string().min(1),
  entry: z.string().min(1),
  language: z.enum(['python', 'qsharp']),
  backend: backendSchema,
  shots: z.number().int().positive(),
  seed: z.number().int(),
  sweep: sweepSchema.optional(),
  notes: z.string().optional(),
});
export type ExperimentSpec = z.infer<typeof experimentSpecSchema>;

// ---------------------------------------------------------------------------
// Grid expansion — the most correctness-critical code in the PRD.
// ---------------------------------------------------------------------------

export type GridExpansionErrorCode =
  | 'invalid_step'
  | 'empty_range'
  | 'grid_too_large';

/** Typed error carrying the computed point count when the grid is too large. */
export class GridExpansionError extends Error {
  readonly code: GridExpansionErrorCode;
  /** Total computed grid size (only meaningful for `grid_too_large`). */
  readonly count: number;
  /** Offending parameter name, when the fault is a single dimension. */
  readonly param?: string;

  constructor(
    code: GridExpansionErrorCode,
    message: string,
    count = 0,
    param?: string,
  ) {
    super(message);
    this.name = 'GridExpansionError';
    this.code = code;
    this.count = count;
    this.param = param;
  }
}

/**
 * Expand a `range: [start, stop, step]` like numpy.arange but WITH an epsilon
 * so that a `stop` which is an exact multiple of `step` is included.
 * `step` must be strictly positive (negative/zero step is a guarded error).
 */
export function expandRange(
  range: readonly [number, number, number],
  param?: string,
): number[] {
  const [start, stop, step] = range;
  if (!Number.isFinite(step) || step <= 0) {
    throw new GridExpansionError(
      'invalid_step',
      `range step must be a positive finite number (got ${step})`,
      0,
      param,
    );
  }
  if (!Number.isFinite(start) || !Number.isFinite(stop)) {
    throw new GridExpansionError(
      'invalid_step',
      `range start/stop must be finite (got [${start}, ${stop}])`,
      0,
      param,
    );
  }
  // Count of points: floor((stop-start)/step + eps) + 1. The epsilon lets an
  // exact-multiple stop land; e.g. [0,1,0.25] -> 5 points incl. 1.0.
  const count = Math.floor((stop - start) / step + RANGE_EPSILON) + 1;
  if (count < 1) {
    throw new GridExpansionError(
      'empty_range',
      `range [${start}, ${stop}, ${step}] produces no values (stop is behind start)`,
      0,
      param,
    );
  }
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(start + i * step);
  return out;
}

/** The concrete value list for a single swept parameter. */
export function paramValues(spec: SweepParam, param?: string): number[] {
  return 'range' in spec ? expandRange(spec.range, param) : spec.values;
}

/**
 * Expand a sweep into an ordered list of concrete parameter points.
 *
 * ORDERING CONVENTION (documented + tested): parameters vary in DECLARATION
 * order, with the FIRST-declared parameter varying FASTEST (innermost loop)
 * and the last-declared varying slowest (outermost loop). So for
 * `{theta: 10 values, layers: 3 values}` the sequence is
 * (theta0,layers0), (theta1,layers0), … (theta9,layers0), (theta0,layers1), …
 * This matches the PRD manifest example (theta at index 7 → point_index 7) and
 * the Phase-E "metric-vs-theta grouped by layers" plot, where the outer
 * (slowest) parameter is the natural grouping key.
 *
 * No sweep → a single empty point `[{}]`. Total size is hard-capped at
 * MAX_GRID_POINTS; exceeding it throws a GridExpansionError carrying the count.
 * Every returned point preserves declaration order in its keys.
 */
export function expandGrid(sweep?: Sweep): Array<Record<string, number>> {
  if (!sweep) return [{}];
  const dims = Object.entries(sweep).map(([name, spec]) => ({
    name,
    values: paramValues(spec, name),
  }));
  if (dims.length === 0) return [{}];

  const total = dims.reduce((acc, d) => acc * d.values.length, 1);
  if (total > MAX_GRID_POINTS) {
    throw new GridExpansionError(
      'grid_too_large',
      `sweep expands to ${total} points, which exceeds the v1 cap of ${MAX_GRID_POINTS}`,
      total,
    );
  }

  const grid: Array<Record<string, number>> = [];
  for (let idx = 0; idx < total; idx += 1) {
    let rem = idx;
    const point: Record<string, number> = {};
    // First-declared dimension varies fastest → take its modulus first.
    for (const dim of dims) {
      const i = rem % dim.values.length;
      point[dim.name] = dim.values[i];
      rem = Math.floor(rem / dim.values.length);
    }
    grid.push(point);
  }
  return grid;
}

// ---------------------------------------------------------------------------
// YAML parsing + validation
// ---------------------------------------------------------------------------

export type ParseExperimentResult =
  | { ok: true; spec: ExperimentSpec }
  | { ok: false; errors: string[] };

/** Strip the `.experiment.yaml` (or any) extension to get a default name. */
function defaultNameFromFilename(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, '');
  return base.replace(/\.experiment\.yaml$/i, '').replace(/\.ya?ml$/i, '');
}

function inferLanguage(entry: unknown): KernelLanguage {
  return typeof entry === 'string' && entry.toLowerCase().endsWith('.qs')
    ? 'qsharp'
    : 'python';
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/**
 * Parse + validate a `*.experiment.yaml` document. Applies filename/extension
 * defaults for `name`/`language` before validation, validates parameter names,
 * and eagerly expands the grid so an oversized/degenerate sweep surfaces as a
 * data-level error rather than blowing up at run time. Never throws.
 */
export function parseExperimentYaml(
  text: string,
  filename: string,
): ParseExperimentResult {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [`YAML parse error: ${msg}`] };
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['experiment file must be a YAML mapping'] };
  }

  // Apply defaults on a shallow copy so validation sees concrete values.
  const withDefaults: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (withDefaults.name === undefined || withDefaults.name === null) {
    withDefaults.name = defaultNameFromFilename(filename);
  }
  if (withDefaults.language === undefined || withDefaults.language === null) {
    withDefaults.language = inferLanguage(withDefaults.entry);
  }

  const parsed = experimentSpecSchema.safeParse(withDefaults);
  if (!parsed.success) {
    return { ok: false, errors: formatIssues(parsed.error) };
  }

  const spec = parsed.data;
  const errors: string[] = [];

  // Parameter names must be valid Python identifiers.
  if (spec.sweep) {
    for (const name of Object.keys(spec.sweep)) {
      if (!isValidParamName(name)) {
        errors.push(`sweep parameter "${name}" is not a valid Python identifier`);
      }
    }
  }

  // Eagerly expand to catch range/size errors at parse time.
  try {
    expandGrid(spec.sweep);
  } catch (e) {
    if (e instanceof GridExpansionError) {
      errors.push(e.message);
    } else {
      throw e;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, spec };
}

// ---------------------------------------------------------------------------
// Run manifest + record schemas (manifest.json shape is PRD-exact)
// ---------------------------------------------------------------------------

export type RunStatus = 'complete' | 'failed' | 'running' | 'stale';

export const gitInfoSchema = z.strictObject({
  commit: z.string(),
  dirty: z.boolean(),
});
export type GitInfo = z.infer<typeof gitInfoSchema>;

export const runManifestSchema = z.strictObject({
  schema: z.literal(1),
  experiment: z.string(),
  point_index: z.number().int().nonnegative(),
  params: z.record(z.string(), z.number()),
  seed: z.number().int(),
  seed_honored: z.boolean(),
  backend: backendSchema,
  shots: z.number().int().nonnegative(),
  language: z.enum(['python', 'qsharp']),
  entry: z.string(),
  code_sha256: z.string(),
  git: gitInfoSchema.nullable(),
  // `nuclei` is always stamped; other keys (python, qiskit, …) are host-driven.
  versions: z.record(z.string(), z.string()),
  started_at: z.string(),
  duration_ms: z.number().nonnegative(),
  status: z.enum(['complete', 'failed', 'running', 'stale']),
  error: z.string().nullable(),
});
export type RunManifest = z.infer<typeof runManifestSchema>;

/**
 * A run as held in memory by the store: its directory id, the parsed manifest,
 * and the merged metrics (derived + user-recorded) read from metrics.json.
 */
export const runRecordSchema = z.strictObject({
  dir: z.string(),
  manifest: runManifestSchema,
  metrics: z.record(z.string(), z.number()),
});
export type RunRecord = z.infer<typeof runRecordSchema>;

// ---------------------------------------------------------------------------
// Derived metrics (pure)
// ---------------------------------------------------------------------------

/**
 * Shannon entropy (base 2, in bits) of a measured-counts distribution.
 * Zero for a determinate/empty distribution.
 */
export function countsEntropy(measurements: Record<string, number>): number {
  const counts = Object.values(measurements).filter((c) => c > 0);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let entropy = 0;
  for (const c of counts) {
    const p = c / total;
    entropy -= p * Math.log2(p);
  }
  // Guard the -0 that a single-outcome distribution produces.
  return entropy === 0 ? 0 : entropy;
}

/** Highest single-state probability in a measured-counts distribution. */
export function topStateProbability(measurements: Record<string, number>): number {
  const counts = Object.values(measurements);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return Math.max(...counts) / total;
}

/** The always-computed derived metrics for any run, both languages. */
export function computeDerivedMetrics(
  measurements: Record<string, number>,
): Record<string, number> {
  return {
    counts_entropy: countsEntropy(measurements),
    top_state_probability: topStateProbability(measurements),
  };
}
