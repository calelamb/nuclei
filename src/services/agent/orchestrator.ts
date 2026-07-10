import type { BackendInfo } from '../../types/hardware';
import type { BudgetLedger } from './budgetLedger';
import type {
  JournalPort,
  KernelPort,
  ModelContentBlock,
  ModelMessage,
  ModelPort,
  ModelReply,
  WorkspacePort,
} from './interfaces';
import { DEFAULT_POLICY } from './policy';
import type { AutonomyPolicy, SubmissionFacts } from './policy';
import type { SubmitPort } from './submitPort';
import { AGENT_TOOLS } from './tools';
import { defaultFrameworkResolver, executeTool } from './toolExecutors';
import type { ToolContext } from './toolExecutors';
import type { AgentBudget, AgentRunResult, AgentRunState, JournalEntry, ToolEvidence } from './types';
import { DEFAULT_BUDGET } from './types';

export interface AgentDeps {
  model: ModelPort;
  kernel: KernelPort;
  workspace: WorkspacePort;
  journal: JournalPort;
  budget?: AgentBudget;
  runId?: string;
  now?: () => number;
  signal?: AbortSignal;
  /** Optional accessor for the currently known hardware backends, forwarded
   * to plan_hardware_run's and submit_hardware_job's ToolContext. Omitted in
   * tests that don't care about hardware — those tools degrade to an
   * "unavailable" result. */
  getBackends?: () => BackendInfo[];
  /** Optional hardware submission channel, forwarded to ToolContext.
   * Omitted means submit_hardware_job/poll_hardware_job/cancel_hardware_job/
   * analyze_hardware_result all degrade to an "unavailable" evidence result
   * rather than erroring — no live socket implementation lives here. */
  submitPort?: SubmitPort;
  /** Autonomy policy gating submit_hardware_job. Defaults to DEFAULT_POLICY
   * (autonomous real-hardware submission OFF) — this is the safety default
   * for every run unless a caller explicitly opts a policy in. */
  policy?: AutonomyPolicy;
  /** Optional spend ledger for reserve/commit/release budget tracking and
   * submission idempotency around submit_hardware_job. */
  ledger?: BudgetLedger;
  /** Optional cost estimator for submit_hardware_job; defaults to a function
   * that always returns null (cost unknown), which DEFAULT_POLICY treats as
   * `needs_approval` for real hardware. */
  estimateCost?: (facts: SubmissionFacts) => number | null;
}

const SYSTEM_PROMPT = `You are Dirac, an autonomous quantum-programming agent embedded in the Nuclei IDE.

Given a goal, use the provided tools to write, parse, and simulate a quantum program until you have
VERIFIED it meets the goal — never assume or invent a result you haven't actually observed.

Rules:
- Use apply_patch to write or edit code. Every edit is reversible and journaled; use rollback_patch if an
  edit turns out to be wrong.
- Use parse_quantum_program to check structure/syntax before simulating. You may also use
  validate_quantum_program to catch semantic issues (out-of-range qubits, control/target collisions,
  arity mismatches) and estimate_quantum_resources to check qubit/gate/depth cost, either before or after
  simulating.
- Use run_simulation to execute the program locally and obtain real probabilities and measurements.
- Use compare_quantum_results to check the simulated probabilities against a numeric success criterion,
  when one was given.
- You may call plan_hardware_run to get a shadow-mode recommendation of a compatible hardware backend for
  the circuit, with an explainable score; this is analysis only for the user's consideration — it never
  submits a job or contacts a provider, and it is not a substitute for run_simulation.
- You may submit a job to real quantum hardware ONLY via submit_hardware_job. This tool is policy-gated by a
  human-controlled autonomy setting: real, paid QPU submissions are disabled by default, and a
  "needs_approval" or "deny" result means NOTHING was submitted. That is the expected, safe outcome — do not
  retry submit_hardware_job to try to force it through; instead, report the result plainly to the user and
  stop. Once a job has actually been submitted, use poll_hardware_job to check its status and
  analyze_hardware_result to read back its measured probabilities (optionally against an expected
  distribution); cancel_hardware_job cancels a still-pending job. Real hardware costs real money.
- Only call finish once you have verified your result via run_simulation (and compare_quantum_results when
  a numeric target was given), or once you are truly blocked and cannot proceed further. Never call finish
  with success: true without having actually run the simulation.
- If a tool reports an error or a conflict, read it, adjust your approach, and try again — you have a
  limited number of turns.`;

function generateRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function textBlocks(text: string): ModelContentBlock[] {
  return text ? [{ type: 'text', text }] : [];
}

function buildSeedMessage(goal: string, workspace: WorkspacePort): ModelMessage {
  const paths = workspace.listFiles().map((f) => f.path);
  const hint = [
    `Goal: ${goal}`,
    '',
    `Workspace files: ${paths.length ? paths.join(', ') : '(none yet)'}.`,
    `Active file: ${workspace.activePath() || '(none)'}.`,
    'Call inspect_project first if you need to see current file contents before editing.',
  ].join('\n');
  return { role: 'user', content: hint };
}

export async function runAgent(goal: string, deps: AgentDeps): Promise<AgentRunResult> {
  const runId = deps.runId ?? generateRunId();
  const now = deps.now ?? (() => Date.now());
  const budget = deps.budget ?? DEFAULT_BUDGET;
  const { model, kernel, workspace, journal, signal, getBackends, submitPort, ledger } = deps;
  const policy = deps.policy ?? DEFAULT_POLICY;
  const estimateCost = deps.estimateCost ?? (() => null);

  const startedAt = now();
  let state: AgentRunState = 'planning';

  const record = (entry: JournalEntry): void => journal.append(entry);

  const transition = (next: AgentRunState): void => {
    record({ kind: 'state_change', ts: now(), from: state, to: next });
    state = next;
  };

  const ctx: ToolContext = {
    workspace,
    kernel,
    lastSim: {},
    lastSnapshot: {},
    resolveFramework: defaultFrameworkResolver(workspace),
    lastKnownHash: new Map<string, string>(),
    getBackends,
    submitPort,
    policy,
    ledger,
    estimateCost,
  };

  let messages: ModelMessage[] = [buildSeedMessage(goal, workspace)];
  transition('working');

  let lastCompareMatched: boolean | null = null;
  let iterations = 0;
  let success = false;
  let summary = '';
  let finished = false;

  while (iterations < budget.maxIterations) {
    if (signal?.aborted) {
      transition('cancelled');
      return {
        runId,
        state,
        success: false,
        iterations,
        summary: 'Run cancelled.',
        journal: journal.entries(),
      };
    }

    if (now() - startedAt > budget.maxWallMs) {
      break;
    }

    iterations += 1;

    let reply: ModelReply;
    try {
      reply = await model.complete({ system: SYSTEM_PROMPT, messages, tools: AGENT_TOOLS });
    } catch (e) {
      record({ kind: 'error', ts: now(), message: e instanceof Error ? e.message : String(e) });
      break;
    }

    if (reply.text) {
      record({ kind: 'model_text', ts: now(), text: reply.text });
    }

    if (reply.toolUses.length === 0) {
      finished = true;
      success = lastCompareMatched === true;
      summary = success
        ? 'Model ended the turn without calling finish, but a prior comparison had already matched.'
        : 'Model ended the turn without calling finish or verifying a matching result.';
      break;
    }

    const assistantContent: ModelContentBlock[] = [
      ...textBlocks(reply.text),
      ...reply.toolUses.map((tu) => ({ type: 'tool_use' as const, id: tu.id, name: tu.name, input: tu.input })),
    ];
    messages = [...messages, { role: 'assistant', content: assistantContent }];

    const toolResultBlocks: ModelContentBlock[] = [];
    let finishRequested: { success: boolean; summary: string } | null = null;

    for (const toolUse of reply.toolUses) {
      record({ kind: 'tool_call', ts: now(), toolCallId: toolUse.id, tool: toolUse.name, input: toolUse.input });

      let evidence: ToolEvidence;
      try {
        evidence = await executeTool(toolUse.name, toolUse.input, ctx, toolUse.id);
      } catch (e) {
        evidence = {
          toolCallId: toolUse.id,
          tool: toolUse.name,
          ok: false,
          facts: {},
          diagnostics: e instanceof Error ? e.message : String(e),
        };
      }

      record({ kind: 'tool_result', ts: now(), evidence });

      if (evidence.tool === 'compare_quantum_results' && evidence.ok) {
        lastCompareMatched = evidence.facts.matches === true;
      }

      if (evidence.tool === 'finish' && evidence.ok) {
        finishRequested = {
          success: evidence.facts.success === true,
          summary: typeof evidence.facts.summary === 'string' ? evidence.facts.summary : '',
        };
      }

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify({ facts: evidence.facts, diagnostics: evidence.diagnostics ?? null }),
      });
    }

    messages = [...messages, { role: 'user', content: toolResultBlocks }];

    if (finishRequested) {
      finished = true;
      success = finishRequested.success;
      summary =
        finishRequested.summary || (success ? 'Goal verified.' : 'Agent stopped without meeting the goal.');
      break;
    }
  }

  if (!finished) {
    transition('failed');
    return {
      runId,
      state,
      success: false,
      iterations,
      summary: summary || 'Budget exhausted before the goal could be verified.',
      journal: journal.entries(),
    };
  }

  transition('completed');
  return { runId, state, success, iterations, summary, journal: journal.entries() };
}
