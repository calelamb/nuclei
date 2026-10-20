// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDirac } from './useDirac';
import { useDiracStore } from '../stores/diracStore';

describe('useDirac failure handling', () => {
  beforeEach(() => {
    useDiracStore.setState({ messages: [], isLoading: false, apiKey: 'sk-ant-test', conversationMeta: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('turns a 401 into a friendly error card instead of raw JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}', { status: 401 }),
    ));
    const { result } = renderHook(() => useDirac());
    await act(async () => { await result.current.sendMessage('Explain this circuit'); });

    const last = useDiracStore.getState().messages.at(-1);
    expect(last?.role).toBe('assistant');
    expect(last?.content).toBe('');
    expect(last?.error?.kind).toBe('auth');
    expect(last?.error?.action).toBe('update-key');
    expect(last?.error?.details).toContain('invalid x-api-key');
    expect(useDiracStore.getState().isLoading).toBe(false);
  });

  it('maps a network failure to an offline card', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { result } = renderHook(() => useDirac());
    await act(async () => { await result.current.sendMessage('hello'); });
    expect(useDiracStore.getState().messages.at(-1)?.error?.kind).toBe('offline');
  });

  it('does not replay failed turns to the API on the next message', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValueOnce(new Response('{}', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useDirac());
    await act(async () => { await result.current.sendMessage('one'); });
    await act(async () => { await result.current.sendMessage('two'); });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(body.messages.every((m: { content: unknown }) => m.content !== '')).toBe(true);
    expect(body.messages.some((m: { role: string }) => m.role === 'assistant')).toBe(false);
  });
});
