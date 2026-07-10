import { kernelLanguageFor } from '../../types/quantum';
import { compareDistributions } from './analysis';
import { hashContent } from './hash';
import { DEFAULT_POLICY, evaluateSubmission } from './policy';
import type { SubmissionFacts } from './policy';
import type { ToolContext } from './toolContext';
import { asNumber, asRecord, asString, fail, ok } from './toolHelpers';
import type { ToolEvidence } from './types';

// ---------------------------------------------------------------------------
// Hardware-submission tool executors. This is the ONLY code path in the
// agent runtime that can reach a real, paid quantum backend — every branch
// here is deliberately conservative:
//   - submit_hardware_job NEVER calls ctx.submitPort.submit(...) unless
//     evaluateSubmission(...) returned `allow`.
//   - Every other outcome (deny, needs_approval, duplicate, unavailable) is
//     reported back to the model as ordinary `ok: true` evidence — a normal,
//     expected result the agent should read and act on, not an exception.
//   - None of these executors ever throw.
// ---------------------------------------------------------------------------

function isSimulatorBackend(provider: string, backendName: string): boolean {
  return provider === 'simulator' || backendName.toLowerCase().startsWith('sim');
}

export async function execSubmitHardwareJob(
  input: Record<string, unknown>,
  toolCallId: string,
  ctx: ToolContext,
): Promise<ToolEvidence> {
  const backendName = asString(input.backend);
  const shots = asNumber(input.shots);

  if (!backendName) return fail('submit_hardware_job', toolCallId, 'A string "backend" is required.');
  if (shots === null) return fail('submit_hardware_job', toolCallId, 'A number "shots" is required.');

  const backends = ctx.getBackends?.() ?? [];
  const backend = backends.find((b) => b.name === backendName);
  if (!backend) {
    return fail('submit_hardware_job', toolCallId, `Backend not available: ${backendName}`, { backend: backendName });
  }

  const path = ctx.workspace.activePath();
  const file = ctx.workspace.readFile(path);
  if (!file) return fail('submit_hardware_job', toolCallId, `No active file to submit: ${path}`);

  const language = kernelLanguageFor(ctx.resolveFramework(path));

  let snapshot = ctx.lastSnapshot?.snapshot;
  if (!snapshot) {
    const outcome = await ctx.kernel.parse(file.content, language);
    if (!outcome.ok) {
      return fail('submit_hardware_job', toolCallId, outcome.error, { path, line: outcome.line ?? null });
    }
    snapshot = outcome.snapshot;
  }

  const isSimulator = isSimulatorBackend(backend.provider, backend.name);
  const estimatedCost = ctx.estimateCost
    ? ctx.estimateCost({
        provider: backend.provider,
        backend: backend.name,
        shots,
        qubits: snapshot.qubit_count,
        depth: snapshot.depth,
        isSimulator,
        estimatedCost: null,
      })
    : null;

  const facts: SubmissionFacts = {
    provider: backend.provider,
    backend: backend.name,
    shots,
    qubits: snapshot.qubit_count,
    depth: snapshot.depth,
    isSimulator,
    estimatedCost,
  };

  const policy = ctx.policy ?? DEFAULT_POLICY;
  const remaining = ctx.ledger ? ctx.ledger.remaining() : Number.POSITIVE_INFINITY;
  const decision = evaluateSubmission(facts, policy, remaining);

  // SAFETY GATE: submitPort is only ever reached below this line, and only
  // when decision.decision === 'allow'.
  if (decision.decision !== 'allow') {
    return ok('submit_hardware_job', toolCallId, {
      submitted: false,
      decision: decision.decision,
      reasons: decision.reasons,
    });
  }

  if (!ctx.submitPort) {
    return ok('submit_hardware_job', toolCallId, {
      submitted: false,
      decision: 'unavailable',
      reasons: ['No hardware submission channel configured.'],
    });
  }

  const idempotencyKey = `${backend.name}:${shots}:${hashContent(file.content)}`;
  if (ctx.ledger?.hasSubmitted(idempotencyKey)) {
    return ok('submit_hardware_job', toolCallId, {
      submitted: false,
      decision: 'duplicate',
      jobId: ctx.ledger.submittedJobId(idempotencyKey) ?? null,
    });
  }

  let reservationId: string | null = null;
  if (ctx.ledger && estimatedCost !== null && estimatedCost > 0) {
    const reservation = ctx.ledger.reserve(estimatedCost);
    if (!reservation.ok) {
      return ok('submit_hardware_job', toolCallId, {
        submitted: false,
        decision: 'deny',
        reasons: [`budget: ${reservation.reason}`],
      });
    }
    reservationId = reservation.reservationId;
  }

  const submission = await ctx.submitPort.submit({
    provider: backend.provider,
    backend: backend.name,
    shots,
    code: file.content,
    language,
  });

  if (!submission.ok) {
    if (reservationId) ctx.ledger?.release(reservationId);
    return fail('submit_hardware_job', toolCallId, submission.error, { decision: 'allow', submitted: false });
  }

  if (reservationId) ctx.ledger?.commit(reservationId, estimatedCost ?? 0);
  ctx.ledger?.recordSubmission(idempotencyKey, submission.jobId);

  return ok('submit_hardware_job', toolCallId, {
    submitted: true,
    jobId: submission.jobId,
    decision: 'allow',
  });
}

export async function execPollHardwareJob(
  input: Record<string, unknown>,
  toolCallId: string,
  ctx: ToolContext,
): Promise<ToolEvidence> {
  const jobId = asString(input.job_id);
  if (!jobId) return fail('poll_hardware_job', toolCallId, 'A string "job_id" is required.');

  if (!ctx.submitPort) {
    return ok('poll_hardware_job', toolCallId, {
      available: false,
      reasons: ['No hardware submission channel configured.'],
    });
  }

  const status = await ctx.submitPort.status(jobId);
  return ok('poll_hardware_job', toolCallId, {
    available: true,
    jobId: status.jobId,
    status: status.status,
    queuePosition: status.queuePosition ?? null,
  });
}

export async function execCancelHardwareJob(
  input: Record<string, unknown>,
  toolCallId: string,
  ctx: ToolContext,
): Promise<ToolEvidence> {
  const jobId = asString(input.job_id);
  if (!jobId) return fail('cancel_hardware_job', toolCallId, 'A string "job_id" is required.');

  if (!ctx.submitPort) {
    return ok('cancel_hardware_job', toolCallId, {
      available: false,
      reasons: ['No hardware submission channel configured.'],
    });
  }

  const cancelled = await ctx.submitPort.cancel(jobId);
  return ok('cancel_hardware_job', toolCallId, { jobId, cancelled });
}

export async function execAnalyzeHardwareResult(
  input: Record<string, unknown>,
  toolCallId: string,
  ctx: ToolContext,
): Promise<ToolEvidence> {
  const jobId = asString(input.job_id);
  if (!jobId) return fail('analyze_hardware_result', toolCallId, 'A string "job_id" is required.');

  if (!ctx.submitPort) {
    return ok('analyze_hardware_result', toolCallId, {
      available: false,
      reasons: ['No hardware submission channel configured.'],
    });
  }

  const result = await ctx.submitPort.results(jobId);
  if ('error' in result) {
    return fail('analyze_hardware_result', toolCallId, result.error, { jobId });
  }

  const facts: Record<string, unknown> = {
    available: true,
    jobId: result.jobId,
    probabilities: result.probabilities,
  };

  const expected = asRecord(input.expected_probabilities);
  if (expected) {
    const normalizedExpected: Record<string, number> = {};
    for (const [state, value] of Object.entries(expected)) {
      normalizedExpected[state] = asNumber(value) ?? 0;
    }
    facts.comparison = compareDistributions(result.probabilities, normalizedExpected);
  }

  return ok('analyze_hardware_result', toolCallId, facts);
}
