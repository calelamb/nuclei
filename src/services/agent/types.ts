import type { Framework } from '../../types/quantum';

/**
 * Lifecycle states for a single closed-loop agent run. `planning` is the
 * brief setup phase before the first model call; `working` covers the
 * tool-use loop; the run always ends in exactly one of `completed`,
 * `failed`, or `cancelled`. `paused` is reserved for a future interactive
 * checkpoint (e.g. awaiting user confirmation before an irreversible
 * action) — the orchestrator in this task never emits it.
 */
export type AgentRunState =
  | 'planning'
  | 'working'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused';

export interface AgentBudget {
  maxIterations: number;
  maxWallMs: number;
}

export const DEFAULT_BUDGET: AgentBudget = {
  maxIterations: 12,
  maxWallMs: 120_000,
};

/**
 * The structured, deterministic result of executing one tool call. This is
 * what gets fed back to the model as a `tool_result` — never raw exceptions
 * or free-form prose the model would have to parse.
 */
export interface ToolEvidence {
  toolCallId: string;
  tool: string;
  ok: boolean;
  facts: Record<string, unknown>;
  diagnostics?: string;
}

/**
 * A reversible, hash-verified record of one `apply_patch` call. Rollback is
 * only permitted while the file's current content hash still matches
 * `afterHash` — if something else changed the file since, rollback fails
 * loudly instead of silently clobbering someone else's edit.
 */
export interface PatchTransaction {
  id: string;
  path: string;
  beforeContent: string;
  afterContent: string;
  beforeHash: string;
  afterHash: string;
  appliedAt: number;
  rolledBack: boolean;
}

/**
 * The append-only run journal. Every entry is timestamped and tagged with a
 * `kind` so the log can be replayed, serialized, or inspected without
 * re-deriving state from the raw model transcript.
 */
export type JournalEntry =
  | { kind: 'state_change'; ts: number; from: AgentRunState; to: AgentRunState }
  | { kind: 'model_text'; ts: number; text: string }
  | { kind: 'tool_call'; ts: number; toolCallId: string; tool: string; input: Record<string, unknown> }
  | { kind: 'tool_result'; ts: number; evidence: ToolEvidence }
  | { kind: 'error'; ts: number; message: string };

export interface AgentRunResult {
  runId: string;
  state: AgentRunState;
  success: boolean;
  iterations: number;
  summary: string;
  journal: JournalEntry[];
}

export interface WorkspaceFile {
  path: string;
  framework: Framework;
  content: string;
  dirty: boolean;
}
