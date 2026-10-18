/**
 * PRD 14 addendum §G: the Conjecture Engine protocol and records.
 *
 * Wire shapes follow the kernel contract (`discovery_conjecture_*`). Where the
 * kernel leaves a payload open (evidence items, the `quantities` list), the
 * types are permissive and `services/conjecture/evidence.ts` normalises them.
 */

import type { LlmUsage } from './discovery';

export const PREDICATE_OPS = ['==', '!=', '<', '<=', '>', '>=', 'in'] as const;
export type PredicateOp = (typeof PREDICATE_OPS)[number];

export type PredicateValue = string | number | boolean | Array<string | number>;

export interface PredicateLeaf {
  feature: string;
  op: PredicateOp;
  value: PredicateValue;
}

export type PredicateGroup = { all: PredicateNode[] } | { any: PredicateNode[] };
export type PredicateNode = PredicateLeaf | PredicateGroup;

export type PredictionQuantity = 'beta_upper95' | 'verdict' | 'variance_at_max_n' | 'log2_dla_dimension';

export interface ConjecturePrediction {
  quantity: string;
  op: PredicateOp;
  value: number | string;
}

/** `family` is always `"layered"`; the remaining keys come from the kernel's families schema. */
export type TestFamily = { family: string } & Record<string, unknown>;

export const CIRCUITS_RANGE = [5, 32] as const;
export const POINTS_RANGE = [4, 8] as const;
export const MAX_N_QUBITS = 128;
export const MAX_CONJECTURES = 5;

export interface Conjecture {
  id: string;
  statement: string;
  feature_predicate: PredicateGroup;
  prediction: ConjecturePrediction;
  test_family: TestFamily;
  n_range: [number, number];
  circuits: number;
  points: number;
}

// ── Kernel schema reply ─────────────────────────────────────────────────

export type JsonSchema = Record<string, unknown>;

export interface ConjectureFeatureInfo {
  key: string;
  type: string;
  description: string;
}

export interface ConjectureQuantityInfo {
  key: string;
  description: string;
}

/** The normalised `discovery_conjecture_schema_result`. */
export interface ConjectureSchemaInfo {
  features: ConjectureFeatureInfo[];
  quantities: ConjectureQuantityInfo[];
  families: JsonSchema;
  predicate: JsonSchema;
}

// ── Test results ────────────────────────────────────────────────────────

export type ConjectureVerdict = 'supported' | 'refuted' | 'inconclusive';
export type EvidenceOutcome = 'meets' | 'violates' | 'indeterminate';

export interface EvidencePoint {
  n: number;
  variance: number;
  lo: number | null;
  hi: number | null;
}

/** One held-out circuit, normalised from the kernel's evidence item. */
export interface EvidenceRow {
  circuitIndex: number;
  outcome: EvidenceOutcome;
  features: Record<string, unknown>;
  beta: number | null;
  betaCi: [number, number] | null;
  betaUpper95: number | null;
  points: EvidencePoint[];
  seed: number | null;
  note: string | null;
}

export interface Counterexample {
  family_params: Record<string, unknown>;
  seed: number | null;
  ir: unknown;
  [key: string]: unknown;
}

export interface ConjectureResult {
  verdict: ConjectureVerdict;
  summary: string;
  evidence: unknown[];
  counterexamples: Counterexample[];
  ledger_markdown: string;
  fingerprint: string;
  elapsed_ms: number;
  [key: string]: unknown;
}

// ── Protocol ─────────────────────────────────────────────────────────────

export type ConjectureRequest =
  | { type: 'discovery_conjecture_schema' }
  | { type: 'discovery_conjecture_test'; job_id: string; conjecture: Conjecture; seed: number }
  | { type: 'discovery_conjecture_cancel'; job_id: string };

export type ConjectureResponse =
  | {
      type: 'discovery_conjecture_schema_result';
      features: ConjectureFeatureInfo[];
      quantities: unknown[];
      families: JsonSchema;
      predicate: JsonSchema;
    }
  | { type: 'discovery_conjecture_started'; job_id: string }
  | { type: 'discovery_conjecture_progress'; job_id: string; fraction: number; message: string; circuit_index: number }
  | { type: 'discovery_conjecture_evidence'; job_id: string; item: unknown }
  | {
      type: 'discovery_conjecture_result';
      job_id: string;
      status: 'complete' | 'cancelled' | 'failed';
      result: ConjectureResult | null;
    }
  | { type: 'discovery_conjecture_cancelled'; job_id: string; accepted: boolean };

// ── Ledger ───────────────────────────────────────────────────────────────

export interface ProposerMeta {
  model: string;
  prompt_sha256: string;
  usage: LlmUsage;
  proposed_at: string;
  digest_disclosure: string;
}

export type LedgerOutcome = 'complete' | 'failed';

export interface LedgerEntry {
  /** The conjecture id; unique within a run's ledger. */
  id: string;
  conjecture: Conjecture;
  proposer: ProposerMeta | null;
  outcome: LedgerOutcome;
  /** Null when the job failed before producing a result. */
  result: ConjectureResult | null;
  error: string | null;
  seed: number;
  tested_at: string;
}

export interface LedgerFile {
  schema: 1;
  run_id: string;
  updated_at: string;
  entries: LedgerEntry[];
}
