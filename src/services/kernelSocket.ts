/**
 * Opens a kernel WebSocket and authenticates it with the per-launch token.
 *
 * The kernel closes any connection whose first frame is not
 * `{type:'authenticate', token}`. The token is fetched from the desktop shell
 * (Tauri command) and is never placed in the URL or a subprotocol header.
 * If the shell cannot supply a token the connection is refused outright
 * (`KernelTokenUnavailableError`) rather than opened unauthenticated.
 * The auth frame is sent from an `open` listener registered before the
 * caller can attach `onopen`, so it always precedes the caller's own frames.
 */

export type KernelTokenProvider = () => Promise<string | null>;

/** The desktop shell could not supply a session token for this kernel. */
export class KernelTokenUnavailableError extends Error {
  constructor(detail: string) {
    super(`Kernel session token unavailable: ${detail}`);
    this.name = 'KernelTokenUnavailableError';
  }
}

function describeFailure(cause: unknown): string {
  if (typeof cause === 'string' && cause) return cause;
  if (cause instanceof Error && cause.message) return cause.message;
  return 'token request failed';
}

/**
 * Fails closed: a build that has a token provider (the desktop shell) must
 * never connect without a token, otherwise a stale unauthenticated kernel (or
 * any process squatting the port) would be treated as authenticated. Only
 * builds with no provider at all (web/Pyodide, which never open this socket)
 * take the no-token path.
 */
async function resolveToken(getToken?: KernelTokenProvider): Promise<string | null> {
  if (!getToken) return null;
  let token: string | null;
  try {
    token = await getToken();
  } catch (cause) {
    throw new KernelTokenUnavailableError(describeFailure(cause));
  }
  if (!token) throw new KernelTokenUnavailableError('the shell returned an empty token');
  return token;
}

/** WebSocket close code the kernel uses for a missing or wrong token. */
export const CLOSE_UNAUTHENTICATED = 4401;
export const KERNEL_AUTH_REJECTED_MESSAGE = 'Kernel rejected the session token — restart Nuclei';
export const KERNEL_PROOF_FAILED_MESSAGE =
  'Another program is answering on the kernel port and could not prove it is the Nuclei kernel — quit it and restart Nuclei';
export const KERNEL_AUTH_ACK_TIMEOUT_MS = 12_000;
const NONCE_BYTES = 32;

export class KernelAuthRejectedError extends Error {
  constructor() {
    super(KERNEL_AUTH_REJECTED_MESSAGE);
    this.name = 'KernelAuthRejectedError';
  }
}

/** The peer did not prove knowledge of the session token (squatter or stale kernel). */
export class KernelProofError extends Error {
  constructor() {
    super(KERNEL_PROOF_FAILED_MESSAGE);
    this.name = 'KernelProofError';
  }
}

export interface KernelConnection {
  ws: WebSocket;
  /**
   * Settles once the kernel has accepted the session AND proven it holds the
   * token: resolves on an `authenticated` ack whose `proof` verifies (or on
   * open when no token provider exists), rejects with `KernelAuthRejectedError`
   * on a 4401 close, `KernelProofError` on a missing or wrong proof, and a
   * plain `Error` on any other close or a missing ack. Callers must not treat
   * the kernel as connected before it resolves.
   *
   * With a token, every frame the caller sends after the authenticate frame
   * is held back until the proof verifies, so user code never reaches an
   * unverified listener, and inbound frames are ignored until then.
   */
  authenticated: Promise<void>;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 32 random bytes, hex encoded. */
export function generateNonce(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
}

/** True when `proofHex` is HMAC-SHA256(token, nonce); compared in constant time by WebCrypto. */
export async function verifyKernelProof(token: string, nonce: string, proofHex: unknown): Promise<boolean> {
  if (typeof proofHex !== 'string') return false;
  const signature = hexToBytes(proofHex);
  if (!signature) return false;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(token),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify('HMAC', key, signature, encoder.encode(nonce));
  } catch {
    return false;
  }
}

interface Handshake {
  token: string;
  nonce: string;
}

function parseType(event: Event): { type?: string; proof?: unknown } | null {
  try {
    return JSON.parse((event as MessageEvent<string>).data) as { type?: string; proof?: unknown };
  } catch {
    return null;
  }
}

/**
 * Holds back caller frames until `release()` and drops them on `discard()`.
 * The authenticate frame itself goes out through the original `send`.
 */
function gateOutbound(ws: WebSocket) {
  const rawSend = ws.send.bind(ws);
  const queue: Array<Parameters<WebSocket['send']>[0]> = [];
  let state: 'pending' | 'open' | 'dead' = 'pending';
  ws.send = ((data: Parameters<WebSocket['send']>[0]) => {
    if (state === 'open') rawSend(data);
    else if (state === 'pending') queue.push(data);
  }) as WebSocket['send'];
  return {
    rawSend,
    release() {
      state = 'open';
      for (const data of queue.splice(0)) rawSend(data);
    },
    discard() {
      state = 'dead';
      queue.length = 0;
    },
  };
}

function trackAuthentication(
  ws: WebSocket,
  handshake: Handshake | null,
  ackTimeoutMs: number,
  onVerified: () => void,
  onFailed: () => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const settle = (finish: () => void, ok: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (ok) onVerified();
      else onFailed();
      finish();
    };
    ws.addEventListener('open', () => {
      if (!handshake) {
        settle(resolve, true);
        return;
      }
      timer = setTimeout(
        () => settle(() => reject(new Error('Kernel did not acknowledge the session token')), false),
        ackTimeoutMs,
      );
    });
    ws.addEventListener('message', (event) => {
      if (!handshake || settled) return;
      const parsed = parseType(event);
      if (parsed?.type !== 'authenticated') return;
      void verifyKernelProof(handshake.token, handshake.nonce, parsed.proof).then((valid) => {
        if (valid) {
          settle(resolve, true);
          return;
        }
        settle(() => reject(new KernelProofError()), false);
        try { ws.close(); } catch { /* already closing */ }
      });
    });
    ws.addEventListener('close', (event) => {
      const code = (event as CloseEvent).code;
      settle(() => reject(
        code === CLOSE_UNAUTHENTICATED
          ? new KernelAuthRejectedError()
          : new Error('Kernel connection closed before authentication completed'),
      ), false);
    });
  });
}

export async function openKernelConnection(
  url: string,
  getToken?: KernelTokenProvider,
  ackTimeoutMs: number = KERNEL_AUTH_ACK_TIMEOUT_MS,
): Promise<KernelConnection> {
  const token = await resolveToken(getToken);
  const ws = new WebSocket(url);
  if (token === null) {
    // No provider at all (web build): nothing to authenticate.
    const authenticated = trackAuthentication(ws, null, ackTimeoutMs, () => undefined, () => undefined);
    return { ws, authenticated };
  }

  const handshake: Handshake = { token, nonce: generateNonce() };
  const gate = gateOutbound(ws);
  let verified = false;
  const authenticated = trackAuthentication(
    ws,
    handshake,
    ackTimeoutMs,
    () => { verified = true; gate.release(); },
    () => gate.discard(),
  );

  ws.addEventListener('open', () => {
    gate.rawSend(JSON.stringify({ type: 'authenticate', token, nonce: handshake.nonce }));
  });

  // Registered after the verifier and before any caller handler. Until the
  // proof checks out, nothing from the peer reaches the caller; afterwards
  // the kernel's acknowledgement is swallowed so handlers never see it.
  ws.addEventListener('message', (event) => {
    if (!verified) {
      event.stopImmediatePropagation();
      return;
    }
    if (parseType(event)?.type === 'authenticated') event.stopImmediatePropagation();
  });

  return { ws, authenticated };
}

/** Socket-only variant for callers that do not track the handshake outcome. */
export async function openAuthenticatedKernelSocket(
  url: string,
  getToken?: KernelTokenProvider,
): Promise<WebSocket> {
  const { ws, authenticated } = await openKernelConnection(url, getToken);
  authenticated.catch(() => undefined);
  return ws;
}
