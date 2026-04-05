/**
 * Dirac AI Configuration
 *
 * The API key is loaded from the VITE_CLAUDE_API_KEY environment variable,
 * or falls back to a hardcoded key for development.
 * No API key entry UI is needed — this is a free, open-source tool.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const env = (import.meta as any).env ?? {};

export const DIRAC_API_KEY: string =
  env.VITE_CLAUDE_API_KEY ??
  'sk-ant-api03-PLACEHOLDER_KEY';

export const DIRAC_API_URL = 'https://api.anthropic.com/v1/messages';
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
export const SONNET_MODEL = 'claude-sonnet-4-5-20241022';
