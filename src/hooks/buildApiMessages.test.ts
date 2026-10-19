import { describe, it, expect } from 'vitest';
import { buildApiMessages } from './useDirac';
import type { DiracMessage } from '../stores/diracStore';

const msg = (m: Partial<DiracMessage> & Pick<DiracMessage, 'role' | 'content'>): DiracMessage =>
  ({ id: Math.random().toString(), timestamp: '', ...m }) as DiracMessage;

describe('buildApiMessages', () => {
  it('skips an assistant turn stopped before its first token', () => {
    const out = buildApiMessages(
      [
        msg({ role: 'user', content: 'Explain CNOT' }),
        msg({ role: 'assistant', content: '', stopped: true }),
        msg({ role: 'user', content: 'And a GHZ state?' }),
      ],
      'ctx',
    );
    expect(out.map((m) => m.role)).toEqual(['user', 'user']);
    expect(out.some((m) => m.role === 'assistant' && m.content === '')).toBe(false);
  });

  it('keeps stopped replies that streamed some text and failed turns stay out', () => {
    const out = buildApiMessages(
      [
        msg({ role: 'user', content: 'a' }),
        msg({ role: 'assistant', content: 'partial', stopped: true }),
        msg({ role: 'user', content: 'b' }),
        msg({ role: 'assistant', content: '', error: 'boom' }),
        msg({ role: 'user', content: 'c' }),
      ],
      'ctx',
    );
    expect(out.map((m) => m.content)).toEqual(['a', 'partial', 'b', expect.stringContaining('c')]);
  });
});
