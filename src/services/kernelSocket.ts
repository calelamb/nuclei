/**
 * Opens a kernel WebSocket and authenticates it with the per-launch token.
 *
 * The kernel closes any connection whose first frame is not
 * `{type:'authenticate', token}`. The token is fetched from the desktop shell
 * (Tauri command) and is never placed in the URL or a subprotocol header.
 * The auth frame is sent from an `open` listener registered before the
 * caller can attach `onopen`, so it always precedes the caller's own frames.
 */

export type KernelTokenProvider = () => Promise<string | null>;

async function resolveToken(getToken?: KernelTokenProvider): Promise<string | null> {
  if (!getToken) return null;
  try {
    return await getToken();
  } catch {
    // No token (kernel not started yet, or web/insecure dev): connect without
    // one and let the kernel's own policy decide.
    return null;
  }
}

/** WebSocket close code the kernel uses for a missing or wrong token. */
export const CLOSE_UNAUTHENTICATED = 4401;
export const KERNEL_AUTH_REJECTED_MESSAGE = 'Kernel rejected the session token — restart Nuclei';
export const KERNEL_AUTH_ACK_TIMEOUT_MS = 12_000;

export class KernelAuthRejectedError extends Error {
  constructor() {
    super(KERNEL_AUTH_REJECTED_MESSAGE);
    this.name = 'KernelAuthRejectedError';
  }
}

export interface KernelConnection {
  ws: WebSocket;
  /**
   * Settles once the kernel has accepted the session: resolves on the
   * `authenticated` ack (or on open when no token is sent), rejects with
   * `KernelAuthRejectedError` on a 4401 close and with a plain `Error` on any
   * other close or a missing ack. Callers must not treat the kernel as
   * connected before it resolves.
   */
  authenticated: Promise<void>;
}

function trackAuthentication(ws: WebSocket, sendsToken: boolean, ackTimeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (finish: () => void) => {
      if (timer) clearTimeout(timer);
      timer = null;
      finish();
    };
    ws.addEventListener('open', () => {
      if (!sendsToken) {
        settle(resolve);
        return;
      }
      timer = setTimeout(
        () => settle(() => reject(new Error('Kernel did not acknowledge the session token'))),
        ackTimeoutMs,
      );
    });
    ws.addEventListener('message', (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent<string>).data) as { type?: string };
        if (sendsToken && parsed.type === 'authenticated') settle(resolve);
      } catch {
        // Not JSON: not the ack.
      }
    });
    ws.addEventListener('close', (event) => {
      const code = (event as CloseEvent).code;
      settle(() => reject(
        code === CLOSE_UNAUTHENTICATED
          ? new KernelAuthRejectedError()
          : new Error('Kernel connection closed before authentication completed'),
      ));
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
  const authenticated = trackAuthentication(ws, token !== null, ackTimeoutMs);

  ws.addEventListener('open', () => {
    if (token) ws.send(JSON.stringify({ type: 'authenticate', token }));
  });

  // Swallow the kernel's acknowledgement so existing message handlers never
  // see it. Registered after the ack tracker (which has already seen it), and
  // before any caller handler, so stopImmediatePropagation shields onmessage.
  ws.addEventListener('message', (event) => {
    try {
      const parsed = JSON.parse((event as MessageEvent<string>).data) as { type?: string };
      if (parsed.type === 'authenticated') event.stopImmediatePropagation();
    } catch {
      // Not JSON: leave it for the caller's handler to report.
    }
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
