/** Test double for a `LabSession`: records sends and lets tests emit kernel messages. */

import type { LabSession } from '../lab/labSession';
import type { KernelMessage, KernelResponse } from '../../types/quantum';

export interface FakeLabSession extends LabSession {
  sent: KernelMessage[];
  emit(message: KernelResponse): void;
  /** Simulate the socket dropping. */
  drop(): void;
}

export function createFakeSession(onSend?: (message: KernelMessage, session: FakeLabSession) => void): FakeLabSession {
  const handlers = new Set<(message: KernelResponse) => void>();
  const closeHandlers = new Set<() => void>();
  let closed = false;
  const session: FakeLabSession = {
    sent: [],
    send(message) {
      if (closed) throw new Error('Kernel session is closed');
      session.sent.push(message);
      onSend?.(message, session);
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    onClose(handler) {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    get closed() {
      return closed;
    },
    close() {
      if (closed) return;
      closed = true;
      for (const h of [...closeHandlers]) h();
    },
    emit(message) {
      for (const h of [...handlers]) h(message);
    },
    drop() {
      session.close();
    },
  };
  return session;
}
