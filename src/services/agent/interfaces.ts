import type { CircuitSnapshot, KernelLanguage, SimulationResult } from '../../types/quantum';
import type { JournalEntry, PatchTransaction, WorkspaceFile } from './types';

// ---------------------------------------------------------------------------
// Model port — a non-streaming, multi-turn Anthropic-shaped tool-use call.
// Kept minimal but faithful to the real Messages API content-block shapes so
// a live HTTP implementation is a thin adapter, not a translation layer.
// ---------------------------------------------------------------------------

export type ModelContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string | ModelContentBlock[];
}

export interface AgentToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

export interface ModelRequest {
  system: string;
  messages: ModelMessage[];
  tools: AgentToolSchema[];
}

export interface ModelToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ModelReply {
  text: string;
  toolUses: ModelToolUse[];
  stopReason: string;
}

export interface ModelPort {
  complete(req: ModelRequest): Promise<ModelReply>;
}

// ---------------------------------------------------------------------------
// Kernel port — deterministic parse/simulate outcomes. Never throws; every
// failure mode is represented in the discriminated union so callers (and the
// model, via tool evidence) can react to it explicitly.
// ---------------------------------------------------------------------------

export type ParseOutcome =
  | { ok: true; snapshot: CircuitSnapshot }
  | { ok: false; error: string; line?: number | null };

export type SimOutcome =
  | { ok: true; result: SimulationResult }
  | { ok: false; error: string; line?: number | null };

// ---------------------------------------------------------------------------
// Transpile preview — real qiskit-transpiler metrics for a target backend's
// basis gates / coupling map. Qiskit-only for now; cirq/qsharp/no-circuit
// cases surface as an ok:false outcome with a plain-English reason rather
// than throwing, matching ParseOutcome/SimOutcome's shape.
// ---------------------------------------------------------------------------

export interface TranspileTarget {
  basisGates?: string[];
  couplingMap?: Array<[number, number]>;
  optimizationLevel?: number;
}

export interface TranspileMetrics {
  depth: number;
  gateCounts: Record<string, number>;
  twoQubitCount: number;
  numQubits: number;
  couplingMapped: boolean;
}

export type TranspileOutcome =
  | { ok: true; metrics: TranspileMetrics }
  | { ok: false; error: string };

export interface KernelPort {
  parse(code: string, language: KernelLanguage): Promise<ParseOutcome>;
  simulate(code: string, shots: number, language: KernelLanguage): Promise<SimOutcome>;
  transpile(code: string, target: TranspileTarget): Promise<TranspileOutcome>;
}

// ---------------------------------------------------------------------------
// Workspace port — reversible, conflict-checked file edits.
// ---------------------------------------------------------------------------

export type ApplyPatchResult = PatchTransaction | { conflict: true; currentHash: string };

export interface WorkspacePort {
  listFiles(): WorkspaceFile[];
  readFile(path: string): WorkspaceFile | null;
  applyPatch(path: string, newContent: string, expectedBeforeHash?: string): ApplyPatchResult;
  rollback(transactionId: string): boolean;
  activePath(): string;
}

// ---------------------------------------------------------------------------
// Journal port — append-only run log.
// ---------------------------------------------------------------------------

export interface JournalPort {
  append(entry: JournalEntry): void;
  entries(): JournalEntry[];
}
