import { KERNEL_WS_URL } from '../config/kernel';
import { openAuthenticatedKernelSocket, type KernelTokenProvider } from './kernelSocket';
import type { KernelMessage, KernelResponse } from '../types/quantum';

export type PlatformKind = 'desktop' | 'web';

export interface KernelSession {
  send(message: KernelMessage): void | Promise<void>;
  close(): void;
}

export async function createKernelSession(
  platform: PlatformKind,
  onMessage: (message: KernelResponse) => void,
  getToken?: KernelTokenProvider,
): Promise<KernelSession> {
  if (platform === 'web') {
    const { PyodideKernel } = await import('../platform/pyodideKernel');
    const kernel = new PyodideKernel((msg) => onMessage(msg as KernelResponse));
    await kernel.init();

    return {
      send(message) {
        return kernel.send(message);
      },
      close() {
        // Pyodide is kept alive for the page lifetime.
      },
    };
  }

  // Every desktop socket goes through the shared authenticated path so the
  // per-launch token is the first frame the kernel sees.
  const ws = await openAuthenticatedKernelSocket(KERNEL_WS_URL, getToken);

  return new Promise((resolve, reject) => {

    ws.addEventListener('open', () => {
      ws.addEventListener('message', (event) => {
        try {
          onMessage(JSON.parse(event.data) as KernelResponse);
        } catch {
          onMessage({
            type: 'error',
            message: 'Failed to parse kernel response',
            phase: 'execute',
            code: 'execution_error',
          });
        }
      });

      resolve({
        send(message) {
          if (ws.readyState !== WebSocket.OPEN) {
            throw new Error(`Kernel not connected at ${KERNEL_WS_URL}`);
          }
          ws.send(JSON.stringify(message));
        },
        close() {
          ws.close();
        },
      });
    }, { once: true });

    ws.addEventListener('error', () => {
      reject(new Error(`Failed to connect to kernel at ${KERNEL_WS_URL}`));
    }, { once: true });
  });
}
