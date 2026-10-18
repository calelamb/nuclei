/**
 * PRD 14 — Discovery Engine wire types, Kernel Protocol v1.3. These mirror
 * `kernel/discovery/*` payloads exactly; see
 * docs/research/PRD_14_QUANTUM_AI_LAB.md §6. The `*.discovery.yaml` schema
 * (zod) and UI-only types belong below the "Spec + UI types" marker.
 */

export type DiscoveryEvaluatorKind = 'qec_memory' | 'state_synthesis' | 'vqe_ground_state';

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

export interface DiscoveryEvaluation {
  candidate_id: string;
  run_id: string;
  status: EvaluationStatus;
  fitness: number | null;
  objectives: Record<string, ObjectiveValue>;
  descriptors: Record<string, number>;
  metrics: Record<string, unknown>;
  guardrails: GuardrailResult[];
  rejection: { guardrail: string; message: string } | null;
  failure: { stage: 'sandbox' | 'score'; code: string; message: string } | null;
  stdout: string;
  stderr: string;
  timings_ms: { sandbox?: number; score?: number; total: number };
  evaluator: { kind: DiscoveryEvaluatorKind; version: string; fingerprint: string };
  seed: number;
}

export interface AstMutation {
  program: string;
  operators: string[];
  description: string;
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
    }
  | { type: 'discovery_cancel'; run_id: string; candidate_id?: string }
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
  | { type: 'discovery_mutations'; mutations: AstMutation[] };

export const EVOLVE_START_MARKER = '# EVOLVE-BLOCK-START';
export const EVOLVE_END_MARKER = '# EVOLVE-BLOCK-END';

// ── Spec + UI types ─────────────────────────────────────────────────────
