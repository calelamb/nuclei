import { KERNEL_WS_URL } from '../config/kernel';
import type { KernelMessage, KernelResponse } from '../types/quantum';

export type PlatformKind = 'desktop' | 'web';

export interface KernelSession {
  send(message: KernelMessage): void | Promise<void>;
  close(): void;
}

export async function createKernelSession(
  platform: PlatformKind,
  onMessage: (message: KernelResponse) => void,
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

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(KERNEL_WS_URL);

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
