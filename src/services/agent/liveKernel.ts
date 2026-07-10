import type { CircuitSnapshot, Framework, KernelLanguage, SimulationResult } from '../../types/quantum';
import type { KernelPort, ParseOutcome, SimOutcome } from './interfaces';

/**
 * Minimal transport shape SessionKernel needs to speak the isolated-worker
 * `agent_execute` protocol (see kernel/agent_protocol.py + the
 * `agent_execute` handler in kernel/server.py). This protocol is
 * deliberately separate from the normal parse/execute KernelMessage /
 * KernelResponse wire shapes used by useKernel.ts — every agent run
 * executes in a disposable worker subprocess, correlated by request_id,
 * rather than against the shared serial kernel session. Keeping the
 * message types as `object`/`unknown` here (rather than importing the
 * normal KernelMessage/KernelResponse union) keeps this adapter decoupled
 * from that unrelated protocol and easy to fake in tests.
 */
export interface KernelTransport {
  send(message: object): void;
  onMessage(handler: (message: unknown) => void): () => void;
}

type AgentExecuteAction = 'parse' | 'simulate';

interface AgentExecuteRequest {
  type: 'agent_execute';
  request_id: string;
  action: AgentExecuteAction;
  framework: Framework;
  language: KernelLanguage;
  code: string;
  shots?: number;
}

interface AgentResultMessage {
  type: 'agent_result';
  request_id: string;
  status: 'ok' | 'error';
  snapshot: CircuitSnapshot | null;
  result: SimulationResult | null;
  stdout: string;
  stderr: string;
  error: { code?: string; message: string } | null;
}

function isAgentResultMessage(value: unknown): value is AgentResultMessage {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.type === 'agent_result' && typeof v.request_id === 'string';
}

interface PendingRequest {
  kind: AgentExecuteAction;
  resolve: (outcome: ParseOutcome | SimOutcome) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

let requestCounter = 0;

function generateRequestId(): string {
  requestCounter += 1;
  return `agent_${Date.now().toString(36)}_${requestCounter}`;
}

function outcomeFromAgentResult(kind: AgentExecuteAction, msg: AgentResultMessage): ParseOutcome | SimOutcome {
  if (msg.status === 'ok') {
    if (kind === 'parse') {
      if (!msg.snapshot) return { ok: false, error: 'Kernel returned an empty snapshot.' };
      return { ok: true, snapshot: msg.snapshot };
    }
    if (!msg.result) return { ok: false, error: 'Kernel returned an empty result.' };
    return { ok: true, result: msg.result };
  }
  return { ok: false, error: msg.error?.message ?? `${kind} failed`, line: null };
}

/**
 * KernelPort backed by the isolated-worker `agent_execute` protocol. Every
 * parse/simulate call is a fully self-contained request-response pair
 * correlated by `request_id`, so unlike the normal serial kernel session,
 * multiple requests may be in flight concurrently — there is no ordering
 * assumption on the wire.
 *
 * The framework is not part of the KernelPort interface (parse/simulate
 * only take `code` and `language`, matching orchestrator.ts and
 * toolExecutors.ts unchanged), so it's supplied via a resolver function
 * injected at construction time — typically reading the live workspace's
 * currently active framework.
 */
export class SessionKernel implements KernelPort {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly unsubscribe: () => void;
  private readonly transport: KernelTransport;
  private readonly resolveFramework: () => Framework;
  private readonly timeoutMs: number;

  constructor(transport: KernelTransport, resolveFramework: () => Framework, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.transport = transport;
    this.resolveFramework = resolveFramework;
    this.timeoutMs = timeoutMs;
    this.unsubscribe = transport.onMessage((msg) => this.handleMessage(msg));
  }

  private settle(requestId: string, outcome: ParseOutcome | SimOutcome): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timeoutHandle);
    pending.resolve(outcome);
  }

  private handleMessage(msg: unknown): void {
    if (!isAgentResultMessage(msg)) return;
    const pending = this.pending.get(msg.request_id);
    if (!pending) return;
    this.settle(msg.request_id, outcomeFromAgentResult(pending.kind, msg));
  }

  private request(
    kind: AgentExecuteAction,
    build: (requestId: string) => AgentExecuteRequest,
  ): Promise<ParseOutcome | SimOutcome> {
    return new Promise((resolve) => {
      const requestId = generateRequestId();
      const entry: PendingRequest = {
        kind,
        resolve,
        timeoutHandle: setTimeout(() => {
          this.pending.delete(requestId);
          resolve({ ok: false, error: 'Timed out waiting for the kernel.' });
        }, this.timeoutMs),
      };
      this.pending.set(requestId, entry);
      this.transport.send(build(requestId));
    });
  }

  async parse(code: string, language: KernelLanguage): Promise<ParseOutcome> {
    const outcome = await this.request('parse', (requestId) => ({
      type: 'agent_execute',
      request_id: requestId,
      action: 'parse',
      framework: this.resolveFramework(),
      language,
      code,
    }));
    return outcome as ParseOutcome;
  }

  async simulate(code: string, shots: number, language: KernelLanguage): Promise<SimOutcome> {
    const outcome = await this.request('simulate', (requestId) => ({
      type: 'agent_execute',
      request_id: requestId,
      action: 'simulate',
      framework: this.resolveFramework(),
      language,
      code,
      shots,
    }));
    return outcome as SimOutcome;
  }

  /** Detach from the transport. Safe to call once; further messages are
   * ignored after disposal. */
  dispose(): void {
    this.unsubscribe();
  }
}
