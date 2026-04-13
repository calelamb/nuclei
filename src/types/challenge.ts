import type { Framework } from './quantum';

export type ChallengeDifficulty = 'easy' | 'medium' | 'hard';
export type ChallengeCategory = 'state-preparation' | 'algorithms' | 'optimization' | 'protocols';
export type ChallengeContractKind = 'returns_circuit';
export type ChallengeArgumentType = 'integer' | 'number' | 'string' | 'boolean' | 'array' | 'object';

export type ValidationMode =
  | { type: 'probability_match'; expected: Record<string, number>; tolerance: number }
  | { type: 'metric'; metric: 'approximation_ratio'; threshold: number; optimal: number };

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

export interface QuantumChallenge {
  id: string;
  title: string;
  difficulty: ChallengeDifficulty;
  category: ChallengeCategory;
  description: string;
  constraints: string[];
  examples: ChallengeExample[];
  testCases: TestCase[];
  starterCode: Record<Framework, string>;
  hints: string[];
  tags: string[];
  estimatedMinutes: number;
  totalSubmissions: number;
  acceptanceRate: number;
  visualization?: ChallengeVisualization;
  default_framework?: Framework;
  entrypoint_name?: string;
  contract_kind?: ChallengeContractKind;
  arguments?: ChallengeArgument[];
  visible_tests?: TestCase[];
  hidden_tests?: TestCase[];
  starter_template?: string;
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
  actualOutput?: Record<string, number>;
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
  currentCode: Record<Framework, string>;
}
