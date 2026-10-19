import { createHmac } from 'node:crypto';

/** What the real kernel answers to an authenticate frame (see kernel/auth.py). */
export function kernelAckFor(authenticateFrame: string, token: string): Record<string, string> {
  const frame = JSON.parse(authenticateFrame) as { nonce?: string };
  if (typeof frame.nonce !== 'string') return { type: 'authenticated' };
  return {
    type: 'authenticated',
    proof: createHmac('sha256', token).update(frame.nonce).digest('hex'),
  };
}

/** Ack for the first authenticate frame in `sent`. */
export function ackForSent(sent: readonly string[], token: string): Record<string, string> {
  const frame = sent.find((data) => data.includes('"authenticate"'));
  if (!frame) throw new Error('no authenticate frame was sent');
  return kernelAckFor(frame, token);
}
