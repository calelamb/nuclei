import type { BackendInfo } from '../../types/hardware';
import { estimateResources } from './analysis';
import type { TranspileTarget } from './interfaces';
import type { ToolContext } from './toolContext';
import { asString, fail, ok } from './toolHelpers';
import type { ToolEvidence } from './types';

// ---------------------------------------------------------------------------
// preview_backend_transpilation: real qiskit-transpiler metrics (depth, gate
// counts, two-qubit count) for the parsed circuit against a target hardware
// backend's basis gates and coupling map. Qiskit-only — kept in its own
// module (rather than toolExecutors.ts) to keep that file under the
// project's file-size guidance. Never throws: every failure mode (no file,
// non-qiskit framework, no backend, kernel error) is reported as ordinary
// evidence for the model to read, matching the rest of this codebase's tool
// executor pattern (see hardwareSubmitExecutors.ts).
// ---------------------------------------------------------------------------

const TOOL_NAME = 'preview_backend_transpilation';

function resolvePath(input: Record<string, unknown>, ctx: ToolContext): string {
  const explicit = asString(input.path);
  return explicit ?? ctx.workspace.activePath();
}

/** Picks the requested backend by name, or the first online backend when no
 * name was given. Returns null (never throws) when nothing qualifies. */
function pickBackend(backends: BackendInfo[], requestedName: string | null): BackendInfo | null {
  if (requestedName) return backends.find((b) => b.name === requestedName) ?? null;
  return backends.find((b) => b.status === 'online') ?? null;
}

/** Maps a hardware backend's advertised capabilities to a qiskit transpile
 * target. Empty gate sets / connectivity lists are omitted (rather than
 * passed as empty arrays) so the kernel's transpile() treats them as "no
 * constraint" instead of an impossible zero-gate/zero-edge target. */
function targetFromBackend(backend: BackendInfo): TranspileTarget {
  const target: TranspileTarget = {};
  if (backend.gateSet.length > 0) target.basisGates = backend.gateSet.map((g) => g.toLowerCase());
  if (backend.connectivity.length > 0) target.couplingMap = backend.connectivity;
  return target;
}

function transpileNote(preTwoQubitCount: number | null, postDepth: number, postTwoQubitCount: number, backendName: string): string {
  if (preTwoQubitCount === null) {
    return `Post-transpile on ${backendName}: depth ${postDepth}, ${postTwoQubitCount} two-qubit gates.`;
  }
  return (
    `Two-qubit gate count went from ${preTwoQubitCount} pre-transpile to ${postTwoQubitCount} ` +
    `post-transpile on ${backendName} (post-transpile depth ${postDepth}).`
  );
}

export async function execPreviewBackendTranspilation(
  input: Record<string, unknown>,
  toolCallId: string,
  ctx: ToolContext,
): Promise<ToolEvidence> {
  const path = resolvePath(input, ctx);
  const file = ctx.workspace.readFile(path);
  if (!file) return fail(TOOL_NAME, toolCallId, `No file at path: ${path}`);

  const framework = ctx.resolveFramework(path);
  if (framework !== 'qiskit') {
    return ok(TOOL_NAME, toolCallId, {
      available: false,
      message: 'Transpilation preview currently supports Qiskit.',
    });
  }

  const backends = ctx.getBackends?.() ?? [];
  const requestedName = asString(input.backend);
  const backend = pickBackend(backends, requestedName);
  if (!backend) {
    return ok(TOOL_NAME, toolCallId, {
      available: false,
      message: requestedName
        ? `Backend not available: ${requestedName}`
        : 'No online hardware backends to preview transpilation against.',
    });
  }

  const target = targetFromBackend(backend);
  const outcome = await ctx.kernel.transpile(file.content, target);

  if (!outcome.ok) {
    return fail(TOOL_NAME, toolCallId, outcome.error, { path, backend: backend.name });
  }

  const preSnapshot = ctx.lastSnapshot?.snapshot;
  const preTwoQubitCount = preSnapshot ? estimateResources(preSnapshot).twoQubitGateCount : null;

  return ok(TOOL_NAME, toolCallId, {
    available: true,
    path,
    backend: backend.name,
    metrics: outcome.metrics,
    note: transpileNote(preTwoQubitCount, outcome.metrics.depth, outcome.metrics.twoQubitCount, backend.name),
  });
}
