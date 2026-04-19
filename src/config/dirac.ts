/**
 * Dirac AI Configuration
 *
 * BYOK (Bring Your Own Key): Users provide their own Anthropic API key
 * via Settings > Dirac AI. The key is stored in localStorage and never
 * leaves the user's machine. An optional env var override is supported
 * for development or pre-configured deployments.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const env = (import.meta as any).env ?? {};

export const DIRAC_API_KEY: string = env.VITE_CLAUDE_API_KEY ?? '';

export const DIRAC_API_URL = 'https://api.anthropic.com/v1/messages';
// Authoritative model IDs — update these when Anthropic ships a new family.
// Anthropic rejects unknown IDs with HTTP 400; date-suffixed names below
// without a matching published snapshot are a common silent-fail cause.
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
export const SONNET_MODEL = 'claude-sonnet-4-6';
export const OPUS_MODEL = 'claude-opus-4-7';
