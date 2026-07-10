import type { ToolEvidence } from './types';

// ---------------------------------------------------------------------------
// Shared, dependency-free helpers used by every tool executor module
// (toolExecutors.ts, hardwareSubmitExecutors.ts). Kept separate so the
// executor modules can import them both without creating a circular runtime
// dependency between themselves.
// ---------------------------------------------------------------------------

export function ok(tool: string, toolCallId: string, facts: Record<string, unknown>): ToolEvidence {
  return { toolCallId, tool, ok: true, facts };
}

export function fail(
  tool: string,
  toolCallId: string,
  diagnostics: string,
  facts: Record<string, unknown> = {},
): ToolEvidence {
  return { toolCallId, tool, ok: false, facts, diagnostics };
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
