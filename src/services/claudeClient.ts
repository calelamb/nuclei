import { useDiracStore } from '../stores/diracStore';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export interface ClaudeCallInput {
  system: string;
  user: string;
  maxTokens: number;
  model?: string;
}

export type ClaudeError = 'no_api_key' | 'http_error' | 'network_error' | 'bad_response';

export interface ClaudeResult {
  text: string | null;
  error: ClaudeError | null;
}

/**
 * Minimal shared wrapper around the Anthropic Messages API.
 * - Reads the user's API key from diracStore.
 * - No API key → `{ text: null, error: 'no_api_key' }`. Every AI feature
 *   must treat this as a silent skip.
 * - HTTP or network failure → `{ text: null, error: ... }`, never throws.
 * Consumers are expected to handle null gracefully.
 */
export async function callClaude(input: ClaudeCallInput): Promise<ClaudeResult> {
  const apiKey = useDiracStore.getState().apiKey;
  if (!apiKey || !apiKey.trim()) {
    return { text: null, error: 'no_api_key' };
  }

  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: input.model ?? DEFAULT_MODEL,
        max_tokens: input.maxTokens,
        system: input.system,
        messages: [{ role: 'user', content: input.user }],
      }),
    });

    if (!response.ok) return { text: null, error: 'http_error' };

    const data = await response.json();
    const text = data?.content?.[0]?.text;
    if (typeof text !== 'string') return { text: null, error: 'bad_response' };
    return { text: text.trim(), error: null };
  } catch {
    return { text: null, error: 'network_error' };
  }
}
