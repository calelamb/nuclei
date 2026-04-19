import { describe, it, expect } from 'vitest';
import {
  CONVERSATION_SCHEMA_VERSION,
  buildConversation,
  newConversation,
  parseConversation,
} from './diracPersistence';
import type { DiracMessage } from '../stores/diracStore';

describe('newConversation', () => {
  it('produces a valid schema-v1 payload with a fresh id + timestamps', () => {
    const c = newConversation();
    expect(c.version).toBe(CONVERSATION_SCHEMA_VERSION);
    expect(c.messages).toEqual([]);
    // Two different new conversations must have different ids.
    expect(c.conversation_id).not.toBe(newConversation().conversation_id);
    // Timestamps parse to valid dates.
    expect(Number.isFinite(new Date(c.created_at).getTime())).toBe(true);
    expect(Number.isFinite(new Date(c.updated_at).getTime())).toBe(true);
  });
});

describe('buildConversation', () => {
  it('preserves caller-supplied conversation_id and created_at', () => {
    const messages: DiracMessage[] = [
      { id: 'm1', role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:00Z' },
    ];
    const out = buildConversation(messages, {
      conversationId: 'abc-123',
      createdAt: '2025-12-31T10:00:00Z',
    });
    expect(out.version).toBe(CONVERSATION_SCHEMA_VERSION);
    expect(out.conversation_id).toBe('abc-123');
    expect(out.created_at).toBe('2025-12-31T10:00:00Z');
    expect(out.messages).toEqual(messages);
    // updated_at stamped now — parses as a later date than created_at.
    expect(new Date(out.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(out.created_at).getTime(),
    );
  });
});

describe('parseConversation', () => {
  it('accepts a well-formed schema-v1 payload verbatim', () => {
    const input = {
      version: 1,
      conversation_id: 'abc',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:01:00Z',
      messages: [
        { id: 'm1', role: 'user', content: 'hi', timestamp: '2026-01-01T00:00:30Z' },
        {
          id: 'm2',
          role: 'assistant',
          content: 'hello',
          timestamp: '2026-01-01T00:00:45Z',
          thinking: 'thinking...',
          toolCalls: [
            { id: 'tc1', name: 'insert_code', input: { code: 'x' }, status: 'executed', result: 'ok' },
          ],
        },
      ],
    };
    const out = parseConversation(input);
    expect(out).not.toBeNull();
    expect(out?.conversation_id).toBe('abc');
    expect(out?.messages).toHaveLength(2);
    expect(out?.messages[1].toolCalls?.[0]).toEqual({
      id: 'tc1',
      name: 'insert_code',
      input: { code: 'x' },
      status: 'executed',
      result: 'ok',
    });
  });

  it('returns null for unknown schema versions (forward-compat)', () => {
    const out = parseConversation({
      version: 99,
      conversation_id: 'x',
      created_at: '',
      updated_at: '',
      messages: [],
    });
    expect(out).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseConversation(null)).toBeNull();
    expect(parseConversation(undefined)).toBeNull();
    expect(parseConversation('string')).toBeNull();
    expect(parseConversation(42)).toBeNull();
  });

  it('demotes pending tool calls to rejected with the standard message', () => {
    const input = {
      version: 1,
      conversation_id: 'x',
      created_at: '',
      updated_at: '',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: '',
          timestamp: '',
          toolCalls: [
            { id: 'tc1', name: 'insert_code', input: {}, status: 'pending' },
          ],
        },
      ],
    };
    const out = parseConversation(input);
    const tc = out?.messages[0].toolCalls?.[0];
    expect(tc?.status).toBe('rejected');
    expect(tc?.result).toBe('Interrupted — please re-ask Dirac if needed.');
  });

  it('demotes unknown tool-call statuses the same way', () => {
    const input = {
      version: 1,
      conversation_id: 'x',
      created_at: '',
      updated_at: '',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: '',
          timestamp: '',
          toolCalls: [
            { id: 'tc1', name: 'x', input: {}, status: 'weird-new-status' },
          ],
        },
      ],
    };
    const tc = parseConversation(input)?.messages[0].toolCalls?.[0];
    expect(tc?.status).toBe('rejected');
  });

  it('drops messages with invalid roles rather than crashing', () => {
    const input = {
      version: 1,
      conversation_id: 'x',
      created_at: '',
      updated_at: '',
      messages: [
        { id: 'm1', role: 'system', content: 'not a valid role', timestamp: '' },
        { id: 'm2', role: 'user', content: 'valid', timestamp: '' },
      ],
    };
    const out = parseConversation(input);
    expect(out?.messages).toHaveLength(1);
    expect(out?.messages[0].role).toBe('user');
  });

  it('backfills missing ids and timestamps so older files still open', () => {
    // Hypothetical pre-schema-v1 file. We never shipped one, but the
    // parser should still produce a usable structure so we don't lose
    // history from some early adopter's stash.
    const input = {
      version: 1,
      conversation_id: 'x',
      created_at: '',
      updated_at: '',
      messages: [{ role: 'user', content: 'old message' }],
    };
    const out = parseConversation(input);
    const m = out?.messages[0];
    expect(m?.id).toMatch(/[0-9a-f-]{8,}/);
    expect(Number.isFinite(new Date(m?.timestamp ?? '').getTime())).toBe(true);
  });

  it('round-trips: buildConversation → serialize → parse yields equal messages', () => {
    const original: DiracMessage[] = [
      { id: 'a', role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:00Z' },
      {
        id: 'b',
        role: 'assistant',
        content: 'hi there',
        timestamp: '2026-01-01T00:00:05Z',
        thinking: 'greeting',
        toolCalls: [
          { id: 't1', name: 'insert_code', input: { code: 'x=1' }, status: 'accepted', result: undefined },
        ],
      },
    ];
    const packaged = buildConversation(original, {
      conversationId: 'c1',
      createdAt: '2026-01-01T00:00:00Z',
    });
    const restored = parseConversation(JSON.parse(JSON.stringify(packaged)));
    expect(restored?.conversation_id).toBe('c1');
    // Strip the optional result=undefined before comparing — JSON.stringify
    // drops undefined fields so sanitizeToolCall drops them too.
    expect(restored?.messages[0]).toEqual(original[0]);
    expect(restored?.messages[1].toolCalls?.[0].id).toBe('t1');
    expect(restored?.messages[1].toolCalls?.[0].status).toBe('accepted');
  });
});
