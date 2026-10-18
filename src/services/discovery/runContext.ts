/**
 * Shared run context for the runner and its proposal tasks. This is the one
 * mutable seam of a run: everything else flows through immutable records.
 */

import type {
  CandidateRecord,
  DiscoveryEvaluation,
  DiscoveryEvaluatorInfo,
  DiscoverySpec,
  RedQueenConfig,
  RunRecord,
  RunUsage,
} from '../../types/discovery';
import type { AuditClient } from './kernelAudit';
import type { KernelEvaluator } from './kernelEval';
import type { AuditPolicyState } from './redQueen';
import type { AuditFinding } from './redQueenPrompt';
import type { DiscoveryLlm } from './llmMutator';
import type { DiscoveryFs, JoinFn, Persister } from './records';
import type { SystemBlock } from './prompt';
import type { RunnerKernelSession } from '../experimentRunner';

export interface RunnerClock {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

export interface DiscoveryDeps {
  session: RunnerKernelSession & { onClose?: (handler: () => void) => () => void };
  fs: DiscoveryFs;
  llm: DiscoveryLlm;
  clock: RunnerClock;
  hash: (text: string) => Promise<string>;
  join: JoinFn;
}

export interface DiscoveryRunContext {
  projectRoot: string;
  /** Definition file name, e.g. `w-state-synthesis.discovery.yaml`. */
  definitionFile: string;
  evaluator: DiscoveryEvaluatorInfo;
  seedProgram: string;
  /** Continue a run from its on-disk state instead of starting a new one. */
  resumeRunId?: string;
}

export type RunnerEvent =
  | { type: 'status'; run: RunRecord }
  | { type: 'candidate'; candidate: CandidateRecord }
  | { type: 'activity'; candidateId: string; phase: 'proposing' | 'screening' | 'evaluating' | 'idle' }
  | { type: 'notice'; message: string };

export interface DiscoveryRunOptions {
  onEvent?: (event: RunnerEvent) => void;
  /** Concurrent LLM requests (default 4). */
  maxLlmConcurrency?: number;
}

export interface RunControl {
  readonly stopped: boolean;
  readonly paused: boolean;
  /** Resolves immediately unless paused; released on resume or stop. */
  gate(): Promise<void>;
}

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

export function createLimiter(limit: number): Limiter {
  let active = 0;
  const waiting: Array<() => void> = [];
  // Hand the slot straight to the next waiter (active stays counted) so a
  // caller arriving between release and wake-up cannot take it too.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return async (fn) => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

/** Red Queen bookkeeping: audit policy, budget used and what earlier audits found. */
export interface RedQueenState {
  config: RedQueenConfig;
  policy: AuditPolicyState;
  /** Audits sent so far (answered or pending), against `config.max_audits`. */
  started: number;
  findings: AuditFinding[];
}

export interface RunContext {
  spec: DiscoverySpec;
  runId: string;
  evaluator: DiscoveryEvaluatorInfo;
  deps: DiscoveryDeps;
  kernel: KernelEvaluator;
  audits: AuditClient;
  /** Non-null only in Red Queen mode. Replaced, never mutated in place. */
  rq: RedQueenState | null;
  control: RunControl;
  system: SystemBlock[];
  candidates: Map<string, CandidateRecord>;
  seenHashes: Map<string, string>;
  seenProgramKeys: Map<string, string>;
  rejections: Array<{ guardrail: string; message: string }>;
  evalLimit: Limiter;
  llmLimit: Limiter;
  getRun(): RunRecord;
  setUsage(update: (usage: RunUsage) => RunUsage): void;
  setRun(patch: Partial<RunRecord>): void;
  saveCandidate(candidate: CandidateRecord): void;
  notice(message: string): void;
  activity(candidateId: string, phase: 'proposing' | 'screening' | 'evaluating' | 'idle'): void;
  persister: Persister;
}

export function primaryObjective(evaluator: DiscoveryEvaluatorInfo) {
  return evaluator.objectives[0];
}

export function isFinalEvaluation(e: DiscoveryEvaluation | null): e is DiscoveryEvaluation {
  return e !== null;
}
