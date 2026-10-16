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

export async function openAuthenticatedKernelSocket(
  url: string,
  getToken?: KernelTokenProvider,
): Promise<WebSocket> {
  const token = await resolveToken(getToken);
  const ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    if (token) ws.send(JSON.stringify({ type: 'authenticate', token }));
  });

  // Swallow the kernel's acknowledgement so existing message handlers never
  // see it. Registered first, so stopImmediatePropagation also shields onmessage.
  ws.addEventListener('message', (event) => {
    try {
      const parsed = JSON.parse((event as MessageEvent<string>).data) as { type?: string };
      if (parsed.type === 'authenticated') event.stopImmediatePropagation();
    } catch {
      // Not JSON: leave it for the caller's handler to report.
    }
  });

  return ws;
}
