// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callClaude } from './claudeClient';
import { useDiracStore } from '../stores/diracStore';

describe('callClaude', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns { text: null, error: no_api_key } when apiKey is empty', async () => {
    useDiracStore.setState({ apiKey: '' });
    const out = await callClaude({ system: 's', user: 'u', maxTokens: 100 });
    expect(out.text).toBeNull();
    expect(out.error).toBe('no_api_key');
  });

  it('posts to Anthropic API with the configured api key', async () => {
    useDiracStore.setState({ apiKey: 'sk-test-123' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const out = await callClaude({ system: 'sys', user: 'hello', maxTokens: 50 });
    expect(out.text).toBe('hi');
    expect(out.error).toBeNull();
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test-123');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('returns http_error when response is not ok', async () => {
    useDiracStore.setState({ apiKey: 'sk-test-456' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('rate limited', { status: 429 }),
    );
    const out = await callClaude({ system: 's', user: 'u', maxTokens: 50 });
    expect(out.text).toBeNull();
    expect(out.error).toBe('http_error');
  });

  it('returns network_error on fetch throw', async () => {
    useDiracStore.setState({ apiKey: 'sk-test-789' });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const out = await callClaude({ system: 's', user: 'u', maxTokens: 50 });
    expect(out.text).toBeNull();
    expect(out.error).toBe('network_error');
  });
});
