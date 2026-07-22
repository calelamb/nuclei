import { invoke } from '@tauri-apps/api/core';

import {
  QEC_DATA_MAX_FRAME_BYTES,
  QEC_DATA_URL,
  importMappingSchema,
  outboundQuerySchema,
  projectRelativeSourceSchema,
  qecDataEndpointSchema,
  qecDataInboundFrameSchema,
  sessionIdSchema,
  type ImportJobComplete,
  type ImportJobEvent,
  type ImportMapping,
  type ImportPreviewResult,
  type ImportProbeResult,
  type ImportRequestInput,
  type ImportStartInput,
  type ImportValidationResult,
  type QecDataInboundFrame,
  type QueryFrame,
  type ValidQecQuerySpec,
} from '../types/qecDataProtocol';
import type { QecTilePayload } from '../types/qecData';

type SocketListener = (event: Event | MessageEvent<string>) => void;

export interface QecWebSocket {
  addEventListener(type: string, listener: SocketListener): void;
  send(frame: string): void;
  close(): void;
}

export interface ClientDependencies {
  socketFactory?: (url: string) => QecWebSocket;
  requestIdFactory?: () => string;
}

type PendingKind = 'probe' | 'validate' | 'preview' | 'import' | 'query' | 'cancel';
interface PendingRequest {
  kind: PendingKind;
  phase: 'terminal' | 'awaiting_start' | 'streaming';
  expected?: string;
  targetId?: string;
  resolve(value: unknown): void;
  reject(error: QecDataClientError): void;
  onFrame?: (frame: QecDataInboundFrame) => void;
}

interface ConnectingState {
  resolve(): void;
  reject(error: QecDataClientError): void;
}

export class QecDataClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'QecDataClientError';
    this.code = code;
  }
}

function defaultSocketFactory(url: string): QecWebSocket {
  return new WebSocket(url) as unknown as QecWebSocket;
}

function defaultRequestId(): string {
  return crypto.randomUUID();
}

function asClientError(error: unknown): QecDataClientError {
  if (error instanceof QecDataClientError) return error;
  return new QecDataClientError('invalid_request', error instanceof Error ? error.message : 'QEC request is invalid.');
}

function serializeOutbound(frame: Record<string, unknown>): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(frame);
  } catch (error: unknown) {
    throw asClientError(error);
  }
  if (new TextEncoder().encode(serialized).byteLength > QEC_DATA_MAX_FRAME_BYTES) {
    throw new QecDataClientError('frame_too_large', 'QEC Data Engine frame exceeds 1 MiB.');
  }
  return serialized;
}

export class QecDataClient {
  readonly #url = QEC_DATA_URL;
  readonly #token: string;
  readonly #socketFactory: (url: string) => QecWebSocket;
  readonly #requestIdFactory: () => string;
  #socket: QecWebSocket | null = null;
  #authenticated = false;
  #connecting: ConnectingState | null = null;
  #pending: ReadonlyMap<string, PendingRequest> = new Map();

  constructor(endpoint: unknown, dependencies: ClientDependencies = {}) {
    const parsed = qecDataEndpointSchema.safeParse(endpoint);
    if (!parsed.success) {
      throw new QecDataClientError('invalid_endpoint', 'QEC Data Engine URL must be exactly ws://127.0.0.1:9743.');
    }
    this.#token = parsed.data.token;
    this.#socketFactory = dependencies.socketFactory ?? defaultSocketFactory;
    this.#requestIdFactory = dependencies.requestIdFactory ?? defaultRequestId;
  }

  connect(): Promise<void> {
    if (this.#authenticated) return Promise.resolve();
    if (this.#connecting) return Promise.reject(new QecDataClientError('connection_pending', 'QEC Data Engine connection is pending.'));
    const socket = this.#socketFactory(this.#url);
    this.#socket = socket;
    socket.addEventListener('open', () => this.#sendAuthentication());
    socket.addEventListener('message', (event) => this.#receive(event));
    socket.addEventListener('error', () => this.#disconnect('QEC Data Engine connection failed.'));
    socket.addEventListener('close', () => this.#disconnect('QEC Data Engine disconnected.'));
    return new Promise<void>((resolve, reject) => {
      this.#connecting = { resolve, reject };
    });
  }

  disconnect(): void {
    this.#socket?.close();
    this.#disconnect('QEC Data Engine disconnected.');
  }

  async probe(source: string): Promise<ImportProbeResult> {
    return await this.#oneShot('probe', 'import_probe_result', {
      type: 'import_probe', requestId: this.#requestIdFactory(), source: this.#source(source),
    });
  }

  async validate(source: string, adapterId: string, mapping: ImportMapping): Promise<ImportValidationResult> {
    return await this.#oneShot('validate', 'import_validation_result', {
      type: 'import_validate', requestId: this.#requestIdFactory(), source: this.#source(source),
      adapterId, mapping: importMappingSchema.parse(mapping),
    });
  }

  async preview(source: string, adapterId: string, mapping: ImportMapping, limit = 100): Promise<ImportPreviewResult> {
    if (!Number.isInteger(limit) || limit < 0 || limit > 1000) {
      throw new QecDataClientError('invalid_request', 'Preview limit must be between 0 and 1,000.');
    }
    return await this.#oneShot('preview', 'import_preview_result', {
      type: 'import_preview', requestId: this.#requestIdFactory(), source: this.#source(source),
      adapterId, mapping: importMappingSchema.parse(mapping), limit,
    });
  }

  startImport(input: ImportStartInput, onEvent?: (event: ImportJobEvent) => void): Promise<ImportJobComplete> {
    const requestId = this.#requestIdFactory();
    const parsedSessionId = sessionIdSchema.safeParse(input.sessionId);
    if (!parsedSessionId.success) throw new QecDataClientError('invalid_request', 'Session ID is invalid.');
    return this.#multiFrame('import', requestId, {
      type: 'import_start', requestId, source: this.#source(input.source), adapterId: input.adapterId,
      mapping: importMappingSchema.parse(input.mapping), sessionId: parsedSessionId.data,
      sessionKind: input.sessionKind,
    }, onEvent as ((frame: QecDataInboundFrame) => void) | undefined) as Promise<ImportJobComplete>;
  }

  query(query: ValidQecQuerySpec, onEvent: (event: QueryFrame) => void): Promise<QecTilePayload> {
    const parsed = outboundQuerySchema.parse(query);
    return this.#multiFrame('query', parsed.requestId, {
      type: 'query_start', requestId: parsed.requestId, query: parsed,
    }, (frame) => {
      if (frame.type === 'progress' || frame.type === 'tile') onEvent(frame);
    }) as Promise<QecTilePayload>;
  }

  async cancel(kind: 'import' | 'query', targetId: string): Promise<boolean> {
    const requestId = this.#requestIdFactory();
    const frame = kind === 'query'
      ? { type: 'query_cancel', requestId, queryRequestId: targetId }
      : { type: 'job_cancel', requestId, jobId: targetId };
    const expected = kind === 'query' ? 'query_cancelled' : 'job_cancelled';
    const response = await this.#oneShot<Extract<QecDataInboundFrame, { type: 'query_cancelled' | 'job_cancelled' }>>(
      'cancel', expected, frame, targetId,
    );
    if (response.success) this.#rejectRequest(targetId, new QecDataClientError('request_cancelled', 'QEC operation was cancelled.'));
    return response.success;
  }

  #source(source: string): string {
    const result = projectRelativeSourceSchema.safeParse(source);
    if (!result.success) throw new QecDataClientError('source_not_authorized', 'Source must be a project-relative file outside qec-data.');
    return result.data;
  }

  #oneShot<Result extends QecDataInboundFrame>(kind: PendingKind, expected: string, frame: Record<string, unknown>, targetId?: string): Promise<Result> {
    const requestId = String(frame.requestId);
    return this.#send<Result>(requestId, frame, {
      kind,
      phase: 'terminal', expected, targetId,
      resolve: () => undefined,
      reject: () => undefined,
    });
  }

  #multiFrame(
    kind: 'import' | 'query', requestId: string, frame: Record<string, unknown>,
    onFrame?: (frame: QecDataInboundFrame) => void,
  ): Promise<unknown> {
    return this.#send(requestId, frame, {
      kind, phase: 'awaiting_start', resolve: () => undefined, reject: () => undefined, onFrame,
    });
  }

  #send<Result>(requestId: string, frame: Record<string, unknown>, template: PendingRequest): Promise<Result> {
    if (!this.#authenticated || !this.#socket) {
      return Promise.reject(new QecDataClientError('engine_disconnected', 'QEC Data Engine is not connected.'));
    }
    if (this.#pending.has(requestId)) {
      return Promise.reject(new QecDataClientError('duplicate_request', 'QEC request ID is already pending.'));
    }
    let serialized: string;
    try {
      serialized = serializeOutbound(frame);
    } catch (error: unknown) {
      return Promise.reject(asClientError(error));
    }
    return new Promise<Result>((resolve, reject) => {
      const pending: PendingRequest = {
        ...template,
        resolve: (value) => resolve(value as Result),
        reject,
      };
      this.#pending = new Map(this.#pending).set(requestId, pending);
      try {
        this.#socket?.send(serialized);
      } catch (error: unknown) {
        this.#rejectRequest(requestId, asClientError(error));
      }
    });
  }

  #sendAuthentication(): void {
    try {
      this.#socket?.send(serializeOutbound({ type: 'authenticate', token: this.#token }));
    } catch {
      this.#disconnect('QEC Data Engine authentication failed.');
    }
  }

  #receive(event: Event | MessageEvent<string>): void {
    const data = 'data' in event ? event.data : null;
    if (typeof data !== 'string') {
      this.#protocolFailure('invalid_response', 'QEC Data Engine sent a non-text frame.');
      return;
    }
    if (new TextEncoder().encode(data).byteLength > QEC_DATA_MAX_FRAME_BYTES) {
      this.#protocolFailure('frame_too_large', 'QEC Data Engine frame exceeds 1 MiB.');
      return;
    }
    let unknownFrame: unknown;
    try {
      unknownFrame = JSON.parse(data) as unknown;
    } catch {
      this.#protocolFailure('invalid_response', 'QEC Data Engine sent invalid JSON.');
      return;
    }
    const parsed = qecDataInboundFrameSchema.safeParse(unknownFrame);
    if (!parsed.success) {
      this.#protocolFailure('invalid_response', 'QEC Data Engine sent an invalid frame.');
      return;
    }
    this.#route(parsed.data);
  }

  #route(frame: QecDataInboundFrame): void {
    if (!this.#authenticated) {
      if (frame.type !== 'authenticated') {
        this.#protocolFailure('authentication_failed', 'QEC Data Engine did not authenticate.');
        return;
      }
      this.#authenticated = true;
      const connecting = this.#connecting;
      this.#connecting = null;
      connecting?.resolve();
      return;
    }
    if (frame.type === 'authenticated') {
      this.#protocolFailure('invalid_response', 'QEC Data Engine authenticated twice.');
      return;
    }
    if (frame.type === 'error') {
      const error = new QecDataClientError(frame.code, frame.message);
      if (frame.requestId) this.#rejectRequest(frame.requestId, error);
      else this.#rejectAll(error);
      return;
    }
    const pending = this.#pending.get(frame.requestId);
    if (!pending) return;
    try {
      this.#acceptFrame(frame.requestId, pending, frame);
    } catch (error: unknown) {
      this.#rejectRequest(frame.requestId, asClientError(error));
    }
  }

  #acceptFrame(requestId: string, pending: PendingRequest, frame: QecDataInboundFrame): void {
    if (!['import', 'query'].includes(pending.kind)) {
      if (frame.type !== pending.expected || !this.#matchesCancelTarget(pending, frame)) {
        throw new QecDataClientError('invalid_response', `Expected ${pending.expected}.`);
      }
      pending.onFrame?.(frame);
      this.#resolveRequest(requestId, frame);
      return;
    }
    if (pending.phase === 'awaiting_start') {
      if (frame.type !== 'job_started' || frame.jobKind !== pending.kind || frame.jobId !== requestId) {
        throw new QecDataClientError('invalid_response', `Expected ${pending.kind} job_started.`);
      }
      this.#replacePending(requestId, { ...pending, phase: 'streaming' });
      pending.onFrame?.(frame);
      return;
    }
    if (pending.kind === 'import' && frame.type === 'job_complete' && frame.jobId === requestId) {
      pending.onFrame?.(frame);
      this.#resolveRequest(requestId, frame);
      return;
    }
    if (pending.kind === 'query' && (frame.type === 'progress' || frame.type === 'tile')) {
      pending.onFrame?.(frame);
      if (frame.type === 'tile' && frame.complete) this.#resolveRequest(requestId, frame.tile);
      return;
    }
    throw new QecDataClientError('invalid_response', `Unexpected ${frame.type} for ${pending.kind}.`);
  }

  #matchesCancelTarget(pending: PendingRequest, frame: QecDataInboundFrame): boolean {
    if (pending.kind !== 'cancel') return true;
    if (frame.type === 'job_cancelled') return frame.jobId === pending.targetId;
    if (frame.type === 'query_cancelled') return frame.queryRequestId === pending.targetId;
    return false;
  }

  #replacePending(requestId: string, pending: PendingRequest): void {
    this.#pending = new Map(this.#pending).set(requestId, pending);
  }

  #resolveRequest(requestId: string, value: unknown): void {
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    const next = new Map(this.#pending);
    next.delete(requestId);
    this.#pending = next;
    pending.resolve(value);
  }

  #rejectRequest(requestId: string, error: QecDataClientError): void {
    const pending = this.#pending.get(requestId);
    if (!pending) return;
    const next = new Map(this.#pending);
    next.delete(requestId);
    this.#pending = next;
    pending.reject(error);
  }

  #rejectAll(error: QecDataClientError): void {
    const pending = [...this.#pending.values()];
    this.#pending = new Map();
    for (const request of pending) request.reject(error);
  }

  #protocolFailure(code: string, message: string): void {
    const error = new QecDataClientError(code, message);
    this.#rejectAll(error);
    this.#connecting?.reject(error);
    this.#connecting = null;
    this.#authenticated = false;
    this.#socket?.close();
    this.#socket = null;
  }

  #disconnect(message: string): void {
    if (!this.#socket && !this.#connecting && !this.#authenticated && this.#pending.size === 0) return;
    const error = new QecDataClientError('engine_disconnected', message);
    this.#rejectAll(error);
    this.#connecting?.reject(error);
    this.#connecting = null;
    this.#authenticated = false;
    this.#socket = null;
  }
}

export type QecImportClient = Pick<QecDataClient, 'probe' | 'validate' | 'preview' | 'startImport' | 'cancel'>;
export type QecImportInput = ImportRequestInput;

interface ConnectQecDataOptions {
  launch?: (projectRoot: string) => Promise<unknown>;
  clientDependencies?: ClientDependencies;
}

async function launchFromTauri(projectRoot: string): Promise<unknown> {
  return await invoke<unknown>('qec_data_start', { projectRoot });
}

export async function connectQecDataClient(
  projectRoot: string,
  options: ConnectQecDataOptions = {},
): Promise<QecDataClient> {
  if (!projectRoot.trim()) throw new QecDataClientError('invalid_project_root', 'Open a project before starting the QEC Data Engine.');
  const endpoint = await (options.launch ?? launchFromTauri)(projectRoot);
  const client = new QecDataClient(endpoint, options.clientDependencies);
  await client.connect();
  return client;
}
