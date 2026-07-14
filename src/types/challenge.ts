import type { Framework } from './quantum';

/**
 * Per-framework code for challenge content. Challenge content is
 * Python-only today, so the Python teaching frameworks stay required
 * while Q# is optional until challenges ship Q# starters. Stim is a
 * research framework (QEC Studio, PRD 10) — challenges never target it,
 * so it stays optional permanently.
 */
export type ChallengeCodeByFramework =
  Record<Exclude<Framework, 'qsharp' | 'stim'>, string> &
    Partial<Record<'qsharp' | 'stim', string>>;

export type ChallengeDifficulty = 'easy' | 'medium' | 'hard';
export type ChallengeCategory = 'state-preparation' | 'algorithms' | 'optimization' | 'protocols';
export type ChallengePracticeTrack = 'general' | 'qkd';
export type ChallengeContractKind = 'returns_circuit' | 'returns_value';
export type ChallengeArgumentType = 'integer' | 'number' | 'string' | 'boolean' | 'array' | 'object';
export type ChallengeJsonValue =
  | string
  | number
  | boolean
  | null
  | ChallengeJsonValue[]
  | { [key: string]: ChallengeJsonValue };

export type ValidationMode =
  | { type: 'probability_match'; expected: Record<string, number>; tolerance: number }
  | { type: 'metric'; metric: 'approximation_ratio'; threshold: number; optimal: number }
  | { type: 'value_match'; expected: ChallengeJsonValue; tolerance?: number }
  | { type: 'numeric_match'; expected: number; tolerance: number; path?: string }
  // State-based grading: the harness compares the student's pre-measurement
  // statevector to a hidden reference solution's via |⟨ref|ψ⟩|², recorded as
  // `metrics.fidelity`. Unlike marginal grading it can't be spoofed with a
  // hardcoded product state — it sees phase and entanglement. Requires the
  // challenge to provide `referenceCode` (qiskit). `min_fidelity` defaults to
  // 0.99 (statevector sim is exact; 0.99 only absorbs float noise).
  | { type: 'state_fidelity'; min_fidelity?: number };

export interface TestCase {
  id: string;
  label: string;
  description: string;
  params: Record<string, unknown>;
  validation: ValidationMode;
  hidden: boolean;
  weight: number;
}

export interface ChallengeExample {
  input: string;
  output: string;
  explanation?: string;
}

export interface ChallengeArgument {
  name: string;
  type: ChallengeArgumentType;
  description: string;
  sample?: unknown;
}

export interface ChallengeVisualization {
  type: 'graph';
  nodes: Array<{ id: number; label: string }>;
  edges: Array<{ source: number; target: number; weight?: number }>;
  optimalValue?: number;
}

/**
 * Query-model (oracle-injection) spec. The harness builds an opaque oracle
 * `Gate` from the (hidden) secret params and passes it to `solve(oracle, …)` —
 * the secret itself is NOT passed, so the student must query the oracle rather
 * than hardcode the answer. Correctness is graded by `state_fidelity` against
 * the challenge's `referenceCode` (which uses the same oracle), and the number
 * of oracle applications is recorded as `metrics.oracle_queries`.
 */
export interface OracleSpec {
  /** Python defining `build_oracle(**params) -> qiskit Gate` (labelled). */
  builderCode: string;
  /** Param names passed to `solve` alongside `oracle` (e.g. `['n']`). Any param
   * NOT listed here is secret — used only to build the oracle, never seen by
   * the student's solve. */
  solveParams: string[];
  /** Gate label counted for `oracle_queries` (default `'oracle'`). */
  queryLabel?: string;
}

/**
 * Optimal ("par") circuit-efficiency targets for a challenge, authored per
 * problem. Every field is optional — a problem grades only on the metrics it
 * declares a target for. `twoQubitGates` and `depth` are the primary
 * (hardware-cost) metrics; `gateCount`/`qubits` are secondary. Omitted
 * entirely for parameterized problems whose optimum varies per test case
 * (those still show measured metrics, just without a par/star).
 */
export interface EfficiencyTarget {
  twoQubitGates?: number;
  depth?: number;
  gateCount?: number;
  qubits?: number;
  /** Optimal number of oracle applications (query-model challenges). This is
   * the meaningful efficiency metric for BV/Grover/Simon — the algorithm's
   * query complexity — where raw gate counts are dominated by the injected
   * oracle's internals. */
  oracleQueries?: number;
}

/** Measured efficiency metrics of a submitted circuit (worst case across the
 * graded test cases). Execution time is wall-clock and noisy — informational
 * only, never part of the tier/star. `oracleQueries` is present only for
 * oracle-injection challenges (recorded by the harness). */
export interface CircuitMetrics {
  twoQubitGates: number;
  depth: number;
  gateCount: number;
  qubits: number;
  executionTimeMs?: number;
  oracleQueries?: number;
}

export type EfficiencyMetricKey = 'twoQubitGates' | 'depth' | 'gateCount' | 'qubits' | 'oracleQueries';

/** How a measured metric compares to its authored optimum. */
export type EfficiencyTier = 'optimal' | 'efficient' | 'accepted';

export interface EfficiencyMetricReport {
  key: EfficiencyMetricKey;
  label: string;
  value: number;
  optimal?: number;
  tier: EfficiencyTier;
  primary: boolean;
}

export interface EfficiencyReport {
  metrics: CircuitMetrics;
  reports: EfficiencyMetricReport[];
  /** True when every authored target is met at `optimal` — earns the ★. */
  isOptimal: boolean;
  /** Whether the challenge authored any optimum (else metrics are info-only). */
  hasTarget: boolean;
}

export interface QuantumChallenge {
  id: string;
  title: string;
  difficulty: ChallengeDifficulty;
  category: ChallengeCategory;
  description: string;
  constraints: string[];
  examples: ChallengeExample[];
  testCases: TestCase[];
  starterCode: ChallengeCodeByFramework;
  hints: string[];
  tags: string[];
  estimatedMinutes: number;
  totalSubmissions: number;
  acceptanceRate: number;
  practiceTrack?: ChallengePracticeTrack;
  visualization?: ChallengeVisualization;
  default_framework?: Framework;
  entrypoint_name?: string;
  contract_kind?: ChallengeContractKind;
  arguments?: ChallengeArgument[];
  visible_tests?: TestCase[];
  hidden_tests?: TestCase[];
  starter_template?: string;
  /** Optimal circuit-efficiency targets (LeetCode-style "par"). Optional —
   * absent for value-return (QKD) problems and parameterized problems whose
   * optimum isn't a single fixed number. */
  efficiency?: EfficiencyTarget;
  /** Hidden qiskit reference solution for `state_fidelity` grading. Must define
   * `def reference(**params)` returning the target QuantumCircuit; the harness
   * appends it and records `metrics.fidelity` = |⟨reference|student⟩|². Never
   * shown to the student. */
  referenceCode?: string;
  /** Query-model spec. When set, the harness injects an opaque oracle into
   * `solve` and records `oracle_queries`. Pairs with `referenceCode`. */
  oracle?: OracleSpec;
}

export type SubmissionStatus =
  | 'pending'
  | 'running'
  | 'accepted'
  | 'wrong_answer'
  | 'runtime_error'
  | 'compile_error'
  | 'time_limit_exceeded';

export interface TestCaseResult {
  testCaseId: string;
  passed: boolean;
  score: number;
  verdict: SubmissionStatus;
  actualOutput?: ChallengeJsonValue | Record<string, number>;
  message: string;
  executionTimeMs: number;
}

export interface Submission {
  id: string;
  challengeId: string;
  code: string;
  framework: Framework;
  timestamp: string;
  status: SubmissionStatus;
  testCaseResults: TestCaseResult[];
  totalScore: number;
  executionTimeMs: number;
  /** Circuit efficiency measured on this submission (circuit challenges only,
   * present when the run produced a snapshot). */
  metrics?: CircuitMetrics;
  efficiency?: EfficiencyReport;
}

export type ProblemStatus = 'not_started' | 'attempted' | 'solved';

export interface ProblemProgress {
  challengeId: string;
  status: ProblemStatus;
  bestScore: number;
  attempts: number;
  submissions: Submission[];
  lastAttemptedAt?: string;
  solvedAt?: string;
  currentCode: ChallengeCodeByFramework;
  /** Best (lowest) circuit metrics achieved across accepted submissions. */
  bestMetrics?: CircuitMetrics;
  /** True once the problem has been solved while meeting every optimal
   * target — drives the ★ in the problem list. */
  solvedOptimally?: boolean;
}
