/**
 * Pure routing decisions for the Dirac CHAT surface.
 *
 * Extracted from useDirac so the three Settings → Dirac AI knobs —
 * `preferredModel`, `extendedThinking`, `contextDepth` — are applied in one
 * testable place. Scope is chat only by design: ghost completions,
 * narration, and error rewrite stay on Haiku (latency-critical), and
 * compose / Cmd+K stay on Sonnet (generation quality).
 *
 * Invariant guarded by diracRouting.test.ts: with the default settings
 * (`preferredModel: 'auto'`, `extendedThinking: true`,
 * `contextDepth: 'standard'`) every decision here is identical to the
 * pre-settings inline routing in useDirac.
 */
import { HAIKU_MODEL, SONNET_MODEL } from '../config/dirac';
import type { DiracSettings } from '../stores/settingsStore';

export type PreferredModel = DiracSettings['preferredModel'];
export type ContextDepth = DiracSettings['contextDepth'];

/* ── Heuristics (moved verbatim from useDirac) ───────────── */

export function isExplicitThink(userText: string): boolean {
  return userText.toLowerCase().startsWith('/think');
}

export function hasReasoningKeyword(userText: string): boolean {
  const lower = userText.toLowerCase();
  // 'debug' is deliberately also an action keyword in shouldUseTools;
  // routeChat resolves the overlap in favor of thinking (tools suppressed).
  const reasoningKeywords = [
    'optimize', 'simplify', 'reduce gate', 'prove', 'equivalent',
    'why doesn\'t', 'why isn\'t', 'debug', 'what\'s wrong',
    'state vector after', 'state at step', 'entanglement analysis',
    'error propagation', 'decompose', 'verify correctness',
  ];
  return reasoningKeywords.some((kw) => lower.includes(kw));
}

export function shouldUseTools(userText: string): boolean {
  const lower = userText.toLowerCase();
  // 'debug' deliberately overlaps hasReasoningKeyword's list; when both
  // fire, routeChat lets thinking win and suppresses tools.
  const actionKeywords = [
    'write', 'fix', 'show me', 'insert', 'change', 'create', 'build',
    'make', 'add', 'modify', 'replace', 'implement', 'code', 'generate',
    'run', 'execute', 'simulate', 'try', 'debug', 'correct',
    'highlight', 'step', 'walk through', 'show me the',
    'exercise', 'challenge', 'practice', 'quiz', 'check', 'verify', 'solution',
    'hardware', 'submit', 'run on', 'real quantum', 'ibm', 'backend',
    'hint', 'glossary', 'define', 'definition', 'what is',
  ];
  return actionKeywords.some((kw) => lower.includes(kw));
}

export function heuristicChatModel(userText: string, needsTools: boolean): string {
  if (needsTools) return SONNET_MODEL;
  const lower = userText.toLowerCase();
  const complexKeywords = [
    'explain', 'why', 'how does', 'what does', 'teach', 'concept',
    'difference between', 'compare', 'derive', 'prove', 'understand',
    'step by step', 'in detail', 'elaborate', 'deep dive',
  ];
  const isComplex = userText.length > 100 || complexKeywords.some((kw) => lower.includes(kw));
  return isComplex ? SONNET_MODEL : HAIKU_MODEL;
}

/* ── Settings-aware decisions ────────────────────────────── */

/**
 * Apply the user's `preferredModel` to the heuristic route.
 * Tool-use turns require Sonnet-level capability: when the message needs
 * tools but the user prefers Haiku, capability wins and we use Sonnet anyway.
 */
export function pickChatModel(
  heuristicModel: string,
  preferred: PreferredModel,
  needsTools: boolean,
): string {
  if (needsTools) return SONNET_MODEL;
  if (preferred === 'haiku') return HAIKU_MODEL;
  if (preferred === 'sonnet') return SONNET_MODEL;
  return heuristicModel;
}

/**
 * Gate the extended-thinking escalation. An explicit `/think` is user
 * intent and always wins; reasoning-keyword auto-escalation only fires
 * while the Extended Thinking toggle is on.
 */
export function resolveThinking(
  explicitThink: boolean,
  keywordDetected: boolean,
  extendedThinkingEnabled: boolean,
): boolean {
  if (explicitThink) return true;
  return keywordDetected && extendedThinkingEnabled;
}

export interface ChatRoute {
  model: string;
  /** Send the `thinking: { budget_tokens }` block (always on Sonnet). */
  thinking: boolean;
  /** Pass the tool definitions (suppressed in thinking mode, as before). */
  tools: boolean;
  maxTokens: number;
}

export function routeChat(
  userText: string,
  settings: Pick<DiracSettings, 'preferredModel' | 'extendedThinking'>,
): ChatRoute {
  const needsTools = shouldUseTools(userText);
  const thinking = resolveThinking(
    isExplicitThink(userText),
    hasReasoningKeyword(userText),
    settings.extendedThinking,
  );
  // Thinking turns always run on Sonnet — same capability-wins rule as
  // tools, and identical to the pre-settings behavior.
  const model = thinking
    ? SONNET_MODEL
    : pickChatModel(heuristicChatModel(userText, needsTools), settings.preferredModel, needsTools);
  return {
    model,
    thinking,
    tools: needsTools && !thinking,
    maxTokens: thinking ? 16000 : 4096,
  };
}

/* ── Context depth ───────────────────────────────────────── */

/**
 * Which sections of IDE state the chat context block includes.
 * Editor code and the circuit summary are always sent (they are the
 * minimum Dirac needs to be useful) and are not part of the plan.
 */
export interface ContextPlan {
  /** Simulation probabilities + execution time. */
  results: boolean;
  /** Per-qubit Bloch coordinates (within results). */
  bloch: boolean;
  /** Active exercise metadata. */
  exercise: boolean;
  /** Recent stderr lines. */
  errors: boolean;
  /** Selected hardware backend + last completed hardware-job results. */
  hardware: boolean;
  /** Active weekly-challenge metadata. */
  challenge: boolean;
  /** Top-N measurement outcomes to list. */
  probabilityLimit: number;
  /** Last-N stderr lines to include. */
  errorLineLimit: number;
}

/**
 * Map the Context Depth setting to a context plan.
 * - minimal:  code + circuit summary + recent errors only.
 * - standard: the default — exactly the pre-settings assembly
 *             (everything, top-8 probabilities, last 3 stderr lines).
 * - full:     everything, with deeper detail (top-16 probabilities,
 *             last 10 stderr lines).
 */
export function selectContextSections(depth: ContextDepth): ContextPlan {
  switch (depth) {
    case 'minimal':
      return {
        results: false, bloch: false, exercise: false,
        errors: true, hardware: false, challenge: false,
        probabilityLimit: 8, errorLineLimit: 3,
      };
    case 'full':
      return {
        results: true, bloch: true, exercise: true,
        errors: true, hardware: true, challenge: true,
        probabilityLimit: 16, errorLineLimit: 10,
      };
    case 'standard':
    default:
      return {
        results: true, bloch: true, exercise: true,
        errors: true, hardware: true, challenge: true,
        probabilityLimit: 8, errorLineLimit: 3,
      };
  }
}
