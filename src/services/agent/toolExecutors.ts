import type { Framework, SimulationResult } from '../../types/quantum';
import { kernelLanguageFor } from '../../types/quantum';
import type { KernelPort, WorkspacePort } from './interfaces';
import type { ToolEvidence } from './types';

/** Resolves which framework a path's contents should be interpreted as.
 * Falls back to inspecting the workspace file when present; callers that
 * need a different strategy (e.g. inferring from a not-yet-created path's
 * extension) can supply their own resolver. */
export type FrameworkResolver = (path: string) => Framework;

export function defaultFrameworkResolver(workspace: WorkspacePort): FrameworkResolver {
  return (path: string) => {
    const file = workspace.readFile(path);
    if (file) return file.framework;
    return path.endsWith('.qs') ? 'qsharp' : 'qiskit';
  };
}

export interface ToolContext {
  workspace: WorkspacePort;
  kernel: KernelPort;
  /** Mutable slot holding the most recent simulation result, so
   * compare_quantum_results can reference it without threading it through
   * every tool call explicitly. */
  lastSim: { result?: SimulationResult };
  resolveFramework: FrameworkResolver;
  /** Per-path hash the orchestrator last observed, used as the
   * conflict-check baseline for apply_patch. Updated on every successful
   * patch. */
  lastKnownHash: Map<string, string>;
}

function ok(tool: string, toolCallId: string, facts: Record<string, unknown>): ToolEvidence {
  return { toolCallId, tool, ok: true, facts };
}

function fail(tool: string, toolCallId: string, diagnostics: string, facts: Record<string, unknown> = {}): ToolEvidence {
  return { toolCallId, tool, ok: false, facts, diagnostics };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resolvePath(input: Record<string, unknown>, ctx: ToolContext): string {
  const explicit = asString(input.path);
  return explicit ?? ctx.workspace.activePath();
}

async function execInspectProject(toolCallId: string, ctx: ToolContext): Promise<ToolEvidence> {
  const files = ctx.workspace.listFiles().map((f) => ({ path: f.path, framework: f.framework, dirty: f.dirty }));
  return ok('inspect_project', toolCallId, { files, activePath: ctx.workspace.activePath() });
}

async function execReadQuantumFile(
  input: Record<string, unknown>,
  toolCallId: string,
  ctx: ToolContext,
): Promise<ToolEvidence> {
  const path = asString(input.path);
  if (!path) return fail('read_quantum_file', toolCallId, 'A string "path" is required.');

  const file = ctx.workspace.readFile(path);
  if (!file) return fail('read_quantum_file', toolCallId, `No file at path: ${path}`);

  return ok('read_quantum_file', toolCallId, {
    path: file.path,
    framework: file.framework,
    content: file.content,
    dirty: file.dirty,
  });
}

function execApplyPatch(input: Record<string, unknown>, toolCallId: string, ctx: ToolContext): ToolEvidence {
  const path = asString(input.path);
  const newContent = asString(input.new_content);
  const rationale = asString(input.rationale);

  if (!path) return fail('apply_patch', toolCallId, 'A string "path" is required.');
  if (newContent === null) return fail('apply_patch', toolCallId, 'A string "new_content" is required.');
  if (!rationale) return fail('apply_patch', toolCallId, 'A string "rationale" is required.');

  const expectedBeforeHash = ctx.lastKnownHash.get(path);
  const result = ctx.workspace.applyPatch(path, newContent, expectedBeforeHash);

  if ('conflict' in result) {
    return fail('apply_patch', toolCallId, 'The file changed since it was last observed — re-read it before patching.', {
      conflict: true,
      path,
      currentHash: result.currentHash,
    });
  }

  ctx.lastKnownHash.set(path, result.afterHash);

  return ok('apply_patch', toolCallId, {
    transactionId: result.id,
    path: result.path,
    rationale,
    beforeHash: result.beforeHash,
    afterHash: result.afterHash,
  });
}

function execRollbackPatch(input: Record<string, unknown>, toolCallId: string, ctx: ToolContext): ToolEvidence {
  const transactionId = asString(input.transaction_id);
  if (!transactionId) return fail('rollback_patch', toolCallId, 'A string "transaction_id" is required.');

  const rolledBack = ctx.workspace.rollback(transactionId);
  if (!rolledBack) {
    return fail(
      'rollback_patch',
      toolCallId,
      'Rollback failed — the transaction is unknown, already rolled back, or the file changed since.',
      { transactionId, rolledBack: false },
    );
  }

  return ok('rollback_patch', toolCallId, { transactionId, rolledBack: true });
}

async function execParseQuantumProgram(
  input: Record<string, unknown>,
  toolCallId: string,
  ctx: ToolContext,
): Promise<ToolEvidence> {
  const path = resolvePath(input, ctx);
  const file = ctx.workspace.readFile(path);
  if (!file) return fail('parse_quantum_program', toolCallId, `No file at path: ${path}`);

  const framework = ctx.resolveFramework(path);
  const language = kernelLanguageFor(framework);
  const outcome = await ctx.kernel.parse(file.content, language);

  if (!outcome.ok) {
    return fail('parse_quantum_program', toolCallId, outcome.error, { path, line: outcome.line ?? null });
  }

  return ok('parse_quantum_program', toolCallId, {
    path,
    framework: outcome.snapshot.framework,
    qubitCount: outcome.snapshot.qubit_count,
    classicalBitCount: outcome.snapshot.classical_bit_count,
    depth: outcome.snapshot.depth,
    gateCount: outcome.snapshot.gates.length,
  });
}

async function execRunSimulation(
  input: Record<string, unknown>,
  toolCallId: string,
  ctx: ToolContext,
): Promise<ToolEvidence> {
  const path = resolvePath(input, ctx);
  const file = ctx.workspace.readFile(path);
  if (!file) return fail('run_simulation', toolCallId, `No file at path: ${path}`);

  const shotsInput = input.shots === undefined ? null : asNumber(input.shots);
  if (input.shots !== undefined && shotsInput === null) {
    return fail('run_simulation', toolCallId, 'If provided, "shots" must be a number.');
  }
  const shots = shotsInput ?? 1024;

  const framework = ctx.resolveFramework(path);
  const language = kernelLanguageFor(framework);
  const outcome = await ctx.kernel.simulate(file.content, shots, language);

  if (!outcome.ok) {
    return fail('run_simulation', toolCallId, outcome.error, { path, line: outcome.line ?? null });
  }

  ctx.lastSim.result = outcome.result;

  return ok('run_simulation', toolCallId, {
    path,
    probabilities: outcome.result.probabilities,
    measurements: outcome.result.measurements,
    executionTimeMs: outcome.result.execution_time_ms,
    shotCount: outcome.result.shot_count,
  });
}

const DEFAULT_TOLERANCE = 0.05;

function execCompareQuantumResults(input: Record<string, unknown>, toolCallId: string, ctx: ToolContext): ToolEvidence {
  const expected = asRecord(input.expected_probabilities);
  if (!expected) return fail('compare_quantum_results', toolCallId, 'An "expected_probabilities" object is required.');

  const toleranceInput = input.tolerance === undefined ? null : asNumber(input.tolerance);
  if (input.tolerance !== undefined && toleranceInput === null) {
    return fail('compare_quantum_results', toolCallId, 'If provided, "tolerance" must be a number.');
  }
  const tolerance = toleranceInput ?? DEFAULT_TOLERANCE;

  const actual = ctx.lastSim.result;
  if (!actual) {
    return fail('compare_quantum_results', toolCallId, 'No simulation result available — call run_simulation first.');
  }

  const states = new Set([...Object.keys(expected), ...Object.keys(actual.probabilities)]);
  const perState: Record<string, { expected: number; actual: number; delta: number }> = {};
  let worstDelta = 0;

  for (const state of states) {
    const expectedValue = asNumber(expected[state]) ?? 0;
    const actualValue = actual.probabilities[state] ?? 0;
    const delta = Math.abs(expectedValue - actualValue);
    perState[state] = { expected: expectedValue, actual: actualValue, delta };
    if (delta > worstDelta) worstDelta = delta;
  }

  const matches = worstDelta <= tolerance;

  return ok('compare_quantum_results', toolCallId, { matches, worstDelta, tolerance, perState });
}

function execFinish(input: Record<string, unknown>, toolCallId: string): ToolEvidence {
  const summary = asString(input.summary);
  const success = asBoolean(input.success);

  if (!summary) return fail('finish', toolCallId, 'A string "summary" is required.');
  if (success === null) return fail('finish', toolCallId, 'A boolean "success" is required.');

  return ok('finish', toolCallId, { summary, success });
}

export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
  toolCallId: string,
): Promise<ToolEvidence> {
  const args = asRecord(input) ?? {};

  try {
    switch (name) {
      case 'inspect_project':
        return await execInspectProject(toolCallId, ctx);
      case 'read_quantum_file':
        return await execReadQuantumFile(args, toolCallId, ctx);
      case 'apply_patch':
        return execApplyPatch(args, toolCallId, ctx);
      case 'rollback_patch':
        return execRollbackPatch(args, toolCallId, ctx);
      case 'parse_quantum_program':
        return await execParseQuantumProgram(args, toolCallId, ctx);
      case 'run_simulation':
        return await execRunSimulation(args, toolCallId, ctx);
      case 'compare_quantum_results':
        return execCompareQuantumResults(args, toolCallId, ctx);
      case 'finish':
        return execFinish(args, toolCallId);
      default:
        return fail(name, toolCallId, `Unknown tool: ${name}`);
    }
  } catch (e) {
    return fail(name, toolCallId, e instanceof Error ? e.message : String(e));
  }
}
