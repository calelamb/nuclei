export type Intent = { kind: 'compose' | 'explain'; prompt: string };

const COMPOSE_VERBS = /\b(create|build|make|write|generate|give me|implement)\b/i;
const COMPOSE_SUBJECTS =
  /\b(circuit|state|gate|qubit|algorithm|qft|grover|bell|ghz|teleport|shor)\b/i;

/**
 * Route a chat message to compose (write code) vs explain (everything else).
 * Pure and trivially testable; the heuristic is intentionally simple for v1 —
 * a Haiku-backed classifier can replace this later if false negatives pile up.
 */
export function classifyIntent(raw: string): Intent {
  const trimmed = raw.trim();
  if (trimmed.startsWith('/compose')) {
    return { kind: 'compose', prompt: trimmed.replace(/^\/compose\s*/, '') };
  }
  if (
    trimmed.startsWith('/explain') ||
    trimmed.startsWith('/think') ||
    trimmed.startsWith('/fix')
  ) {
    return { kind: 'explain', prompt: trimmed.replace(/^\/\w+\s*/, '') };
  }
  if (COMPOSE_VERBS.test(trimmed) && COMPOSE_SUBJECTS.test(trimmed)) {
    return { kind: 'compose', prompt: trimmed };
  }
  return { kind: 'explain', prompt: trimmed };
}
