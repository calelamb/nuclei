/**
 * PRD 14 — Discovery Engine wire types, Kernel Protocol v1.3. These mirror
 * `kernel/discovery/*` payloads exactly; see
 * docs/research/PRD_14_QUANTUM_AI_LAB.md §6. The `*.discovery.yaml` schema
 * (zod) and UI-only types belong below the "Spec + UI types" marker.
 */

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export type DiscoveryEvaluatorKind =
  | 'qec_memory'
  | 'state_synthesis'
  | 'vqe_ground_state'
  | 'trainability_frontier';

export type DiscoveryStage = 'screen' | 'full' | 'confirm';
export type DiscoveryIsolation = 'process' | 'bwrap' | 'sandbox-exec';

export type ObjectiveDirection = 'minimize' | 'maximize';

export interface EvaluatorObjectiveDef {
  key: string;
  label: string;
  direction: ObjectiveDirection;
  unit?: string;
}

export interface EvaluatorDescriptorDef {
  key: string;
  label: string;
  min: number;
  max: number;
  default_bins: number;
}

export interface DiscoveryEvaluatorInfo {
  kind: DiscoveryEvaluatorKind;
  version: string;
  title: string;
  description: string;
  task: 'stim_circuit' | 'quantum_circuit';
  entry_signature: string;
  objectives: EvaluatorObjectiveDef[];
  descriptors: EvaluatorDescriptorDef[];
  config_schema: Record<string, unknown>;
  default_config: Record<string, unknown>;
}

export type GuardrailStatus = 'pass' | 'fail' | 'warn' | 'skipped';

export interface GuardrailResult {
  id: string;
  label: string;
  status: GuardrailStatus;
  detail: string | null;
}

export interface ObjectiveValue {
  value: number;
  ci95?: [number, number] | null;
  direction: ObjectiveDirection;
  label: string;
}

export type EvaluationStatus = 'scored' | 'rejected' | 'failed';

/** Addendum §C: per-line gradient diagnostics of a parameterized candidate. */
export interface GradientMapLine {
  /** 1-based line of the candidate program. */
  line: number;
  parameters: string[];
  variance: number;
  dead: boolean;
}

export interface GradientMap {
  method: 'pauli_propagation_exact' | 'statevector_sampling';
  n_qubits: number;
  lines: GradientMapLine[];
  dead_fraction: number;
}

export type EvaluationMetrics = { gradient_map?: GradientMap } & Record<string, unknown>;

export interface DiscoveryEvaluation {
  candidate_id: string;
  run_id: string;
  status: EvaluationStatus;
  fitness: number | null;
  objectives: Record<string, ObjectiveValue>;
  descriptors: Record<string, number>;
  metrics: EvaluationMetrics;
  guardrails: GuardrailResult[];
  rejection: { guardrail: string; message: string } | null;
  failure: { stage: 'sandbox' | 'score'; code: string; message: string } | null;
  stdout: string;
  stderr: string;
  timings_ms: { sandbox?: number; score?: number; total: number };
  evaluator: { kind: DiscoveryEvaluatorKind; version: string; fingerprint: string };
  seed: number;
  // Spec v2 record fields (§6.4). Optional so that pre-v2 fixtures still type.
  stage?: DiscoveryStage;
  /** sha256 of the normalized AST (kernel-side dedup key). */
  program_key?: string;
  cache_hit?: boolean;
  isolation?: DiscoveryIsolation;
  compute?: { backend: string; method: 'statevector_sampling' | 'pauli_propagation_exact' | null };
}

export interface AstMutation {
  program: string;
  operators: string[];
  description: string;
}

/** Red Queen / independent audit (addendum §F): a stricter re-scoring of one artifact. */
export type AuditVerdict = 'consistent' | 'exploit' | 'inconclusive';

export interface AuditCheck {
  id: string;
  label: string;
  status: GuardrailStatus;
  detail: string | null;
}

export interface DiscoveryAudit {
  verdict: AuditVerdict;
  evaluator_fitness: number | null;
  audit_fitness: number | null;
  /** Evaluator fitness minus audit fitness; null when either is unknown. */
  gap: number | null;
  checks: AuditCheck[];
  reasons: string[];
  evaluator: { kind: DiscoveryEvaluatorKind; version: string; fingerprint: string };
  audit_fingerprint: string;
  seed: number;
  isolation: DiscoveryIsolation;
  timings_ms: { sandbox?: number; audit?: number; total: number };
  /** Free-form audit notes from the kernel (a list per the addendum §F contract). */
  notes: string[] | null;
}

export type DiscoveryRequest =
  | { type: 'discovery_evaluators' }
  | {
      type: 'discovery_evaluate';
      run_id: string;
      candidate_id: string;
      evaluator: { kind: DiscoveryEvaluatorKind; config: Record<string, unknown> };
      program: string;
      entry?: string;
      seed: number;
      stage?: DiscoveryStage;
    }
  | { type: 'discovery_cancel'; run_id: string; candidate_id?: string }
  | {
      type: 'discovery_audit';
      run_id: string;
      candidate_id: string;
      evaluator: { kind: DiscoveryEvaluatorKind; config: Record<string, unknown> };
      program: string;
      entry?: string;
      seed: number;
      /** The evaluator's own result for this program, which the audit re-checks. */
      evaluation: DiscoveryEvaluation;
    }
  | { type: 'discovery_audit_cancel'; run_id: string; candidate_id?: string }
  | {
      type: 'discovery_mutate';
      program: string;
      start_marker?: string;
      end_marker?: string;
      seed: number;
      count: number;
    };

export type DiscoveryResponse =
  | { type: 'discovery_evaluators_result'; evaluators: DiscoveryEvaluatorInfo[] }
  | { type: 'discovery_evaluate_accepted'; run_id: string; candidate_id: string; queue_position: number }
  | { type: 'discovery_evaluation'; run_id: string; candidate_id: string; evaluation: DiscoveryEvaluation }
  | { type: 'discovery_cancelled'; run_id: string; candidate_id: string | null; cancelled: number }
  | { type: 'discovery_audit_accepted'; run_id: string; candidate_id: string; queue_position: number }
  | { type: 'discovery_audit_result'; run_id: string; candidate_id: string; audit: DiscoveryAudit }
  | { type: 'discovery_audit_cancelled'; run_id: string; candidate_id: string | null; cancelled: number }
  | { type: 'discovery_mutations'; mutations: AstMutation[] };

export const EVOLVE_START_MARKER = '# EVOLVE-BLOCK-START';
export const EVOLVE_END_MARKER = '# EVOLVE-BLOCK-END';

// ── Spec + UI types ─────────────────────────────────────────────────────

export const DISCOVERY_EVALUATOR_KINDS = [
  'qec_memory',
  'state_synthesis',
  'vqe_ground_state',
  'trainability_frontier',
] as const;

export const MODEL_TIERS = ['haiku', 'sonnet', 'opus'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

/**
 * Range checks reject out-of-range values with the permitted range in the
 * message. Values are never silently clamped: a study's budget is part of
 * its provenance, so the file must say what actually ran.
 */
function boundedInt(label: string, min: number, max: number) {
  return z
    .number(`${label} must be a number`)
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be at least ${min}`)
    .max(max, `${label} must be at most ${max}`);
}

function unitInterval(label: string) {
  return z
    .number(`${label} must be a number`)
    .min(0, `${label} must be between 0 and 1`)
    .max(1, `${label} must be between 0 and 1`);
}

const archiveSchema = z.strictObject({
  descriptors: z.tuple([z.string().min(1), z.string().min(1)]).optional(),
  bins: z.tuple([boundedInt('archive.bins[0]', 2, 64), boundedInt('archive.bins[1]', 2, 64)]).optional(),
});

const searchSchema = z.strictObject({
  islands: boundedInt('search.islands', 1, 8).default(3),
  generations: boundedInt('search.generations', 1, 500).default(25),
  candidates_per_generation: boundedInt('search.candidates_per_generation', 1, 32).default(6),
  archive: archiveSchema.prefault({}),
  migration_interval: boundedInt('search.migration_interval', 0, 500).default(5),
  exploration: unitInterval('search.exploration').default(0.15),
  early_stop_patience: boundedInt('search.early_stop_patience', 0, 500).default(10),
});

const modelsSchema = z.strictObject({
  breadth: z.enum(MODEL_TIERS).default('haiku'),
  depth: z.enum(MODEL_TIERS).default('opus'),
  depth_share: unitInterval('mutator.models.depth_share').default(0.2),
  depth_thinking: z.boolean().default(true),
});

export const MUTATOR_KINDS = ['llm', 'ast', 'hybrid', 'red_queen'] as const;
export type MutatorKind = (typeof MUTATOR_KINDS)[number];

export const AUDIT_EVERY_MODES = ['improvement', 'all', 'top_k'] as const;
export type AuditEvery = (typeof AUDIT_EVERY_MODES)[number];

/** Addendum §F: when and how often Red Queen mode audits a scored candidate. */
const redQueenSchema = z.strictObject({
  audit_every: z.enum(AUDIT_EVERY_MODES, { error: `red_queen.audit_every must be one of ${AUDIT_EVERY_MODES.join(', ')}` }).default('improvement'),
  top_k: boundedInt('red_queen.top_k', 1, 100).default(5),
  max_audits: boundedInt('red_queen.max_audits', 1, 5000).default(50),
});

export type RedQueenConfig = z.infer<typeof redQueenSchema>;

const mutatorSchema = z.strictObject({
  kind: z.enum(MUTATOR_KINDS).default('hybrid'),
  llm_share: unitInterval('mutator.llm_share').default(0.75),
  models: modelsSchema.prefault({}),
  batch_mode: z.boolean().default(false),
  inspirations: boundedInt('mutator.inspirations', 0, 3).default(2),
});

const budgetSchema = z.strictObject({
  max_evaluations: boundedInt('budget.max_evaluations', 1, 5000).default(200),
  max_llm_calls: boundedInt('budget.max_llm_calls', 0, 5000).default(160),
  max_wall_minutes: boundedInt('budget.max_wall_minutes', 1, 1440).default(90),
  max_concurrent_evaluations: boundedInt('budget.max_concurrent_evaluations', 1, 8).default(3),
});

export const discoverySpecSchema = z
  .strictObject({
    schema: z.literal(1, 'schema must be 1'),
    type: z.literal('discovery', 'type must be "discovery"'),
    name: z.string().min(1, 'name must not be empty'),
    description: z.string().default(''),
    program: z.string().min(1, 'program must be a project-relative path to the seed program'),
    entry: z.string().min(1).default('build'),
    evaluator: z.strictObject({
      kind: z.enum(DISCOVERY_EVALUATOR_KINDS, {
        error: `evaluator.kind must be one of ${DISCOVERY_EVALUATOR_KINDS.join(', ')}`,
      }),
      config: z.record(z.string(), z.unknown()).default({}),
    }),
    search: searchSchema.prefault({}),
    evaluation: z
      .strictObject({
        cascade: z.boolean().default(true),
        promote_if: z.enum(['island_median', 'island_best', 'always']).default('island_median'),
      })
      .prefault({}),
    mutator: mutatorSchema.prefault({}),
    /** Optional; only read when `mutator.kind` is `red_queen` (defaults apply). */
    red_queen: redQueenSchema.optional(),
    budget: budgetSchema.prefault({}),
    confirm: z.strictObject({ seeds: boundedInt('confirm.seeds', 0, 10).default(3) }).prefault({}),
    seed: z.number().int('seed must be a whole number').default(0),
    notes: z.string().optional(),
  })
  .superRefine((spec, ctx) => {
    const descriptors = spec.search.archive.descriptors;
    if (descriptors && descriptors[0] === descriptors[1]) {
      ctx.addIssue({
        code: 'custom',
        path: ['search', 'archive', 'descriptors'],
        message: 'the two archive descriptors must be different evaluator descriptors',
      });
    }
  });

export type DiscoverySpec = z.infer<typeof discoverySpecSchema>;

export type ParseDiscoveryResult =
  | { ok: true; spec: DiscoverySpec }
  | { ok: false; errors: string[] };

const DISCOVERY_SUFFIX = /\.discovery\.ya?ml$/i;

export function discoveryBaseName(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, '').replace(DISCOVERY_SUFFIX, '');
}

/**
 * Parse + validate a `*.discovery.yaml` document (schema 1). Never throws.
 * Accepts the legacy single-model form `mutator.model: sonnet` as a
 * breadth-only ensemble (no depth calls).
 */
export function parseDiscoveryYaml(text: string, fileName: string): ParseDiscoveryResult {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    return { ok: false, errors: [`YAML parse error: ${e instanceof Error ? e.message : String(e)}`] };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['discovery file must be a YAML mapping'] };
  }
  const doc: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (doc.name === undefined || doc.name === null) doc.name = discoveryBaseName(fileName);
  if (doc.mutator && typeof doc.mutator === 'object' && !Array.isArray(doc.mutator)) {
    const { model, ...rest } = doc.mutator as Record<string, unknown>;
    if (typeof model === 'string' && rest.models === undefined) {
      doc.mutator = { ...rest, models: { breadth: model, depth: model, depth_share: 0, depth_thinking: false } };
    }
  }
  const parsed = discoverySpecSchema.safeParse(doc);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      }),
    };
  }
  return { ok: true, spec: parsed.data };
}

// ── Run state + on-disk records (§7.4 layout) ───────────────────────────

/** xoshiro128** state: four unsigned 32-bit words. */
export type RngState = readonly [number, number, number, number];

export interface ArchiveElite {
  candidateId: string;
  island: number;
  fitness: number;
  /** Tie-break cost, lower is better (see archive.ts `eliteCost`). */
  cost: number;
  /** Candidate creation order (numeric part of the id); lower is earlier. */
  order: number;
  programHash: string;
  /** Primary-descriptor cell, [column, row]. */
  cell: readonly [number, number];
  descriptors: Record<string, number>;
  /** Objective point estimates, keyed by objective key. */
  objectives: Record<string, number>;
}

export interface ArchiveAxis {
  key: string;
  label: string;
  min: number;
  max: number;
  bins: number;
}

export interface ArchiveState {
  axes: readonly [ArchiveAxis, ArchiveAxis];
  objectives: ReadonlyArray<{ key: string; label: string; direction: ObjectiveDirection }>;
  /** One grid per island: cell key `"col,row"` to the elite. */
  islands: ReadonlyArray<Readonly<Record<string, ArchiveElite>>>;
}

export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface CandidateLlmInfo {
  model: string;
  tier: ModelTier;
  depth: boolean;
  thinking: boolean;
  rationale: string;
  expected_effect: string;
  edits: Array<{ search: string; replace: string }>;
  usage: LlmUsage | null;
  prompt_sha256: string;
  /** Addendum §C: number of flagged-dead gradient-map lines the edits touched. */
  touched_dead_lines: number;
  batch_id: string | null;
}

export type CandidateMutator = 'seed' | 'llm' | 'ast';
export type CandidateOutcome = 'pending' | 'evaluated' | 'screened_out' | 'duplicate' | 'invalid_proposal';

export interface CandidateRecord {
  id: string;
  parent_id: string | null;
  island: number;
  generation: number;
  mutator: CandidateMutator;
  program: string;
  program_sha256: string;
  llm: CandidateLlmInfo | null;
  ast_ops: string[] | null;
  evaluation: DiscoveryEvaluation | null;
  created_at: string;
  // Engine bookkeeping (superset of the §7.4 record).
  outcome: CandidateOutcome;
  eval_seed: number;
  inspiration_ids: string[];
  /** The screen-stage evaluation when the cascade ran. */
  screen: DiscoveryEvaluation | null;
  duplicate_of: string | null;
  proposal_error: string | null;
  in_archive: boolean;
  region_warning: boolean;
  reevaluations: DiscoveryEvaluation[];
  /** Independent audit of this candidate (Red Queen or a manual audit). */
  audit?: DiscoveryAudit | null;
  /** True from the moment an audit is sent until its result lands; resume re-sends it. */
  audit_pending?: boolean;
  /** Why the last audit attempt failed (transport or kernel error), if it did. */
  audit_error?: string | null;
  /** Red Queen fitness (the archive's fitness in that mode); see redQueen.ts. */
  adversarial_fitness?: number | null;
}

export type RunStatus = 'running' | 'paused' | 'completed' | 'stopped' | 'failed' | 'stale';
export type StopReason =
  | 'generations'
  | 'max_evaluations'
  | 'max_llm_calls'
  | 'max_wall_time'
  | 'early_stop'
  | 'user'
  | 'seed_rejected'
  | 'error';

export interface RunUsage {
  evaluations: number;
  llm_calls: number;
  wall_ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  proposals: { llm: number; ast: number; duplicate: number; invalid: number };
}

export interface ConfirmedObjective {
  key: string;
  label: string;
  direction: ObjectiveDirection;
  mean: number;
  /** 95% t-interval across confirmation seeds; null with fewer than 2 scored seeds. */
  ci95: [number, number] | null;
  n: number;
}

export interface RunConfirmation {
  champion_id: string;
  seeds: number[];
  n_scored: number;
  fitness_mean: number | null;
  fitness_ci95: [number, number] | null;
  /** Original fitness minus confirmed mean fitness (winner's-curse estimate). */
  fitness_drop: number | null;
  objectives: ConfirmedObjective[];
  evaluations: DiscoveryEvaluation[];
  created_at: string;
}

export interface PendingBatchItem {
  custom_id: string;
  candidate_id: string;
  island: number;
  parent_id: string;
  inspiration_ids: string[];
  tier: ModelTier;
  depth: boolean;
  eval_seed: number;
  prompt_sha256: string;
  model: string;
  thinking: boolean;
}

export interface PendingBatch {
  batch_id: string;
  generation: number;
  items: PendingBatchItem[];
}

export interface RunRecord {
  schema: 1;
  run_id: string;
  definition_file: string;
  spec: DiscoverySpec;
  evaluator: { kind: DiscoveryEvaluatorKind; version: string; fingerprint: string | null };
  status: RunStatus;
  stop_reason: StopReason | null;
  message: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
  /** Completed generations. */
  generation: number;
  next_candidate_index: number;
  rng: RngState;
  archive: ArchiveState;
  usage: RunUsage;
  champion_id: string | null;
  seed_fitness: number | null;
  /** Global best fitness after each completed generation. */
  best_fitness_history: number[];
  stale_generations: number;
  pending_batch: PendingBatch | null;
  notices: string[];
  confirmation: RunConfirmation | null;
}

// ── Red Queen mode ──────────────────────────────────────────────────────

/**
 * An evaluator exploit: a candidate the evaluator scored well but the
 * independent audit rejected (addendum §F). Derived from the candidate's
 * audit; the fixture id doubles as the file name of its regression fixture.
 */
export interface DiscoveryExploit {
  /** Fixture id, `rq-<runId>-<candidateId>`. */
  id: string;
  candidateId: string;
  title: string;
  gap: number | null;
  evaluatorFitness: number | null;
  auditFitness: number | null;
  /** Audit checks that failed (or warned), the evidence for the verdict. */
  failedChecks: AuditCheck[];
  reasons: string[];
  audit: DiscoveryAudit;
  discoveredBy: 'red_queen' | 'manual_audit';
}

/** The kernel fixture format of `kernel/tests/fixtures/exploits/*.json` (addendum §F). */
export interface ExploitFixture {
  id: string;
  title: string;
  evaluator: { kind: DiscoveryEvaluatorKind; config: Record<string, unknown> };
  program: string;
  entry: string;
  seed: number;
  stage: DiscoveryStage;
  discovered_by: 'red_queen' | 'manual_audit';
  expect: 'audit_exploit';
  notes: string;
}

/** The persisted exploit: the fixture plus the audit that convicted it. */
export type ExploitRecord = ExploitFixture & { audit: DiscoveryAudit };
