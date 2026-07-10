import { describe, expect, it } from 'vitest';
import type { KernelPort, ModelMessage, ModelPort, ModelReply, ModelToolUse, ParseOutcome, SimOutcome } from './interfaces';
import { InMemoryJournal } from './journal';
import { runAgent } from './orchestrator';
import type { JournalEntry } from './types';
import { InMemoryWorkspace } from './workspace';

const FILE_PATH = 'main.py';
const BUGGY_CODE = 'RUNTIME_ERROR marker\n';
const FIXED_CODE = 'from qiskit import QuantumCircuit\n# bell state\n';

interface ScriptedTurn {
  text?: string;
  toolUses: ModelToolUse[];
}

function scriptedModel(turns: ScriptedTurn[]): { model: ModelPort; calls: Array<{ messages: ModelMessage[] }> } {
  const calls: Array<{ messages: ModelMessage[] }> = [];
  let i = 0;
  const model: ModelPort = {
    async complete(req) {
      calls.push({ messages: req.messages });
      const turn = turns[Math.min(i, turns.length - 1)];
      i += 1;
      const reply: ModelReply = {
        text: turn.text ?? '',
        toolUses: turn.toolUses,
        stopReason: turn.toolUses.length > 0 ? 'tool_use' : 'end_turn',
      };
      return reply;
    },
  };
  return { model, calls };
}

function toolUse(id: string, name: string, input: Record<string, unknown>): ModelToolUse {
  return { id, name, input };
}

function makeKernel(): KernelPort {
  return {
    async parse(code: string): Promise<ParseOutcome> {
      if (code.includes('SYNTAX_ERROR')) {
        return { ok: false, error: 'SyntaxError: invalid syntax', line: 1 };
      }
      return {
        ok: true,
        snapshot: { framework: 'qiskit', qubit_count: 2, classical_bit_count: 2, depth: 2, gates: [] },
      };
    },
    async simulate(code: string, shots: number): Promise<SimOutcome> {
      if (code.includes('RUNTIME_ERROR')) {
        return { ok: false, error: 'ZeroDivisionError: division by zero', line: 1 };
      }
      return {
        ok: true,
        result: {
          state_vector: [],
          probabilities: { '00': 0.5, '11': 0.5 },
          measurements: {},
          bloch_coords: [],
          execution_time_ms: 2,
          shot_count: shots,
        },
      };
    },
  };
}

function makeWorkspace(initialContent = ''): InMemoryWorkspace {
  return new InMemoryWorkspace([{ path: FILE_PATH, framework: 'qiskit', content: initialContent, dirty: false }]);
}

function toolCallEntries(journal: JournalEntry[]): Array<Extract<JournalEntry, { kind: 'tool_call' }>> {
  return journal.filter((e): e is Extract<JournalEntry, { kind: 'tool_call' }> => e.kind === 'tool_call');
}

function toolResultEntries(journal: JournalEntry[]): Array<Extract<JournalEntry, { kind: 'tool_result' }>> {
  return journal.filter((e): e is Extract<JournalEntry, { kind: 'tool_result' }> => e.kind === 'tool_result');
}

describe('runAgent', () => {
  it('happy path: apply_patch -> parse -> run_simulation -> compare -> finish', async () => {
    const workspace = makeWorkspace();
    const journal = new InMemoryJournal();
    const { model } = scriptedModel([
      { toolUses: [toolUse('t1', 'apply_patch', { path: FILE_PATH, new_content: FIXED_CODE, rationale: 'bell state' })] },
      { toolUses: [toolUse('t2', 'parse_quantum_program', {})] },
      { toolUses: [toolUse('t3', 'run_simulation', {})] },
      { toolUses: [toolUse('t4', 'compare_quantum_results', { expected_probabilities: { '00': 0.5, '11': 0.5 } })] },
      { toolUses: [toolUse('t5', 'finish', { summary: 'Bell state verified.', success: true })] },
    ]);

    const result = await runAgent('Build a Bell state', {
      model,
      kernel: makeKernel(),
      workspace,
      journal,
    });

    expect(result.success).toBe(true);
    expect(result.state).toBe('completed');
    expect(result.iterations).toBe(5);
    expect(workspace.readFile(FILE_PATH)?.content).toBe(FIXED_CODE);

    const calls = toolCallEntries(result.journal).map((e) => e.tool);
    expect(calls).toEqual([
      'apply_patch',
      'parse_quantum_program',
      'run_simulation',
      'compare_quantum_results',
      'finish',
    ]);

    const results = toolResultEntries(result.journal);
    expect(results).toHaveLength(5);
    expect(results.every((e) => e.evidence.ok)).toBe(true);
  });

  it('repair loop: a failing simulation feeds evidence back and the model converges on a fix', async () => {
    const workspace = makeWorkspace();
    const journal = new InMemoryJournal();
    const { model } = scriptedModel([
      { toolUses: [toolUse('t1', 'apply_patch', { path: FILE_PATH, new_content: BUGGY_CODE, rationale: 'first attempt' })] },
      { toolUses: [toolUse('t2', 'run_simulation', {})] },
      { toolUses: [toolUse('t3', 'apply_patch', { path: FILE_PATH, new_content: FIXED_CODE, rationale: 'fix runtime error' })] },
      { toolUses: [toolUse('t4', 'run_simulation', {})] },
      { toolUses: [toolUse('t5', 'finish', { summary: 'Fixed and verified.', success: true })] },
    ]);

    const result = await runAgent('Build a Bell state', { model, kernel: makeKernel(), workspace, journal });

    expect(result.success).toBe(true);
    expect(result.state).toBe('completed');
    expect(result.iterations).toBe(5);
    expect(workspace.readFile(FILE_PATH)?.content).toBe(FIXED_CODE);

    const results = toolResultEntries(result.journal);
    const simResults = results.filter((e) => e.evidence.tool === 'run_simulation');
    expect(simResults).toHaveLength(2);
    expect(simResults[0].evidence.ok).toBe(false);
    expect(simResults[0].evidence.diagnostics).toMatch(/ZeroDivisionError/);
    expect(simResults[1].evidence.ok).toBe(true);
  });

  it('stops at budget exhaustion when the model never calls finish', async () => {
    const workspace = makeWorkspace();
    const journal = new InMemoryJournal();
    let callCount = 0;
    const model: ModelPort = {
      async complete() {
        callCount += 1;
        return {
          text: '',
          toolUses: [toolUse(`t${callCount}`, 'inspect_project', {})],
          stopReason: 'tool_use',
        };
      },
    };

    const result = await runAgent('Do something never finished', {
      model,
      kernel: makeKernel(),
      workspace,
      journal,
      budget: { maxIterations: 3, maxWallMs: 60_000 },
    });

    expect(result.state).toBe('failed');
    expect(result.success).toBe(false);
    expect(result.iterations).toBe(3);
    expect(callCount).toBe(3);
  });

  it('cancels mid-run when the abort signal fires', async () => {
    const workspace = makeWorkspace();
    const journal = new InMemoryJournal();
    const controller = new AbortController();
    let callCount = 0;
    const model: ModelPort = {
      async complete() {
        callCount += 1;
        if (callCount === 2) controller.abort();
        return {
          text: '',
          toolUses: [toolUse(`t${callCount}`, 'inspect_project', {})],
          stopReason: 'tool_use',
        };
      },
    };

    const result = await runAgent('Build something', {
      model,
      kernel: makeKernel(),
      workspace,
      journal,
      signal: controller.signal,
    });

    expect(result.state).toBe('cancelled');
    expect(result.success).toBe(false);
    // The run stopped before exhausting the default budget.
    expect(result.iterations).toBeLessThan(12);
  });

  it('feeds tool_result evidence back into the next model.complete call', async () => {
    const workspace = makeWorkspace();
    const journal = new InMemoryJournal();
    const { model, calls } = scriptedModel([
      { toolUses: [toolUse('t1', 'inspect_project', {})] },
      { toolUses: [toolUse('t2', 'finish', { summary: 'done', success: true })] },
    ]);

    await runAgent('Inspect then finish', { model, kernel: makeKernel(), workspace, journal });

    expect(calls).toHaveLength(2);
    expect(calls[0].messages).toHaveLength(1);

    const secondCallMessages = calls[1].messages;
    expect(secondCallMessages).toHaveLength(3);
    const lastMessage = secondCallMessages[secondCallMessages.length - 1];
    expect(lastMessage.role).toBe('user');
    expect(Array.isArray(lastMessage.content)).toBe(true);

    const blocks = lastMessage.content as Array<{ type: string; tool_use_id?: string; content?: string }>;
    const toolResultBlock = blocks.find((b) => b.type === 'tool_result');
    expect(toolResultBlock).toBeDefined();
    expect(toolResultBlock?.tool_use_id).toBe('t1');
    expect(toolResultBlock?.content).toContain('activePath');
  });
});
