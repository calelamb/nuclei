# Plan 2 — Ambient AI (narration + error rewrite)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach Dirac to speak on its own after every parse/run and to replace raw Python tracebacks with concept-level explanations — with beginner-safe defaults and graceful degradation when no API key is configured.

**Architecture:** Two independent Haiku-backed services (`narration`, `errorRewrite`) share a thin `claudeClient` helper. Kernel events from `useKernel` fan out to both services. Narrations land in a new `ambientFeed` on `diracStore` and render as dim one-liners in the Dirac sidebar. Error rewrites replace the raw traceback shown in the terminal panel with a friendly explainer card. Every AI path is a no-op without an API key or when the relevant setting is off — the IDE still works.

**Tech Stack:** React 19 + TypeScript + Zustand + Anthropic Messages API (claude-haiku-4-5) + Vitest + jsdom.

**Branch:** `feat/ambient-ai` (cut from current `feat/layout-foundation` tip on origin/main's future merge — in practice: cut from current working branch, let rebase handle it).

**Source spec:** `docs/superpowers/specs/2026-04-18-ai-native-progressive-reveal-design.md` — section 3 rows "Narration" and "Error rewrite"; section 6 (graceful degradation).

---

## Files to create

- `src/services/claudeClient.ts` — thin `callClaude(opts)` wrapper over the Messages API. Reads API key from `diracStore`. Returns `{ text, error }`.
- `src/services/narration.ts` — `narrateParse({ code, snapshot })` and `narrateResult({ code, snapshot, result })` returning a one-line string.
- `src/services/errorRewrite.ts` — `rewritePythonError({ code, traceback, framework })` returning `{ explanation, fix? }`.
- Matching `*.test.ts` for each of the three services.

## Files to modify

- `src/stores/diracStore.ts` — add `ambientFeed`, `pushAmbient()`, `clearAmbient()`, `rewrittenError`, `setRewrittenError()`, `clearRewrittenError()`.
- `src/stores/settingsStore.ts` — add `ai.narration.enabled` (default true), `ai.errorRewrite.enabled` (default true).
- `src/hooks/useKernel.ts` — on snapshot/result call narration; on error phase call errorRewrite.
- `src/components/dirac/DiracSidePanel.tsx` — render `ambientFeed` as a compact stack of recent one-liners.
- `src/components/layout/PanelLayout.tsx` — `TerminalPanel` renders a rewritten-error banner when present.

---

## Task 1: Cut branch + verify baseline

- [ ] **Step 1: Cut branch**

```bash
cd "/Users/calelamb/Desktop/personal projects/nuclei"
git checkout -b feat/ambient-ai
```

- [ ] **Step 2: Verify baseline green**

```bash
npm test -- --run
```

Expected: 47 tests passing.

---

## Task 2: `claudeClient` (TDD)

**Files:**
- Create: `src/services/claudeClient.ts`
- Create: `src/services/claudeClient.test.ts`

- [ ] **Step 1: Write tests**

Create `src/services/claudeClient.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callClaude } from './claudeClient';
import { useDiracStore } from '../stores/diracStore';

describe('callClaude', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns { text: null, error } when apiKey is empty', async () => {
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
```

- [ ] **Step 2: Run test — confirm RED**

```bash
npm test -- --run src/services/claudeClient.test.ts
```

Expected: FAIL module not found.

- [ ] **Step 3: Implement**

Create `src/services/claudeClient.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests — GREEN**

```bash
npm test -- --run src/services/claudeClient.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/claudeClient.ts src/services/claudeClient.test.ts
git commit -m "feat(ai): claudeClient shared Messages API wrapper"
```

---

## Task 3: Add settings toggles

**Files:**
- Read first: `src/stores/settingsStore.ts`
- Modify: `src/stores/settingsStore.ts`

- [ ] **Step 1: Inspect current shape**

```bash
grep -n "ai\|narration\|errorRewrite" src/stores/settingsStore.ts
```

Record: does an `ai` section exist already? If yes, extend it; if not, add.

- [ ] **Step 2: Add `ai` section with narration + errorRewrite flags**

In `settingsStore.ts`, find the state interface + `create` initializer. Add an `ai` sub-section. For consistency with existing `general` / `kernel` sections follow the same pattern.

Concretely, insert (adapting to the existing object shape):

```typescript
// In the state interface:
ai: {
  narration: { enabled: boolean };
  errorRewrite: { enabled: boolean };
};

// In setters (follow existing convention):
setAiNarrationEnabled: (enabled: boolean) => void;
setAiErrorRewriteEnabled: (enabled: boolean) => void;

// In the store initializer:
ai: {
  narration: { enabled: true },
  errorRewrite: { enabled: true },
},
setAiNarrationEnabled: (enabled) =>
  set((s) => ({ ai: { ...s.ai, narration: { enabled } } })),
setAiErrorRewriteEnabled: (enabled) =>
  set((s) => ({ ai: { ...s.ai, errorRewrite: { enabled } } })),
```

- [ ] **Step 3: Typecheck**

```bash
npm run build:web 2>&1 | tail -5
```

Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat(settings): add ai.narration and ai.errorRewrite toggles (default on)"
```

---

## Task 4: `narration` service (TDD)

**Files:**
- Create: `src/services/narration.ts`
- Create: `src/services/narration.test.ts`

- [ ] **Step 1: Write tests**

Create `src/services/narration.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { narrateParse, narrateResult } from './narration';
import * as claudeClient from './claudeClient';
import type { CircuitSnapshot, SimulationResult } from '../types/quantum';

const SNAPSHOT: CircuitSnapshot = {
  framework: 'cirq',
  qubit_count: 2,
  classical_bit_count: 0,
  depth: 1,
  gates: [{ type: 'H', targets: [0], controls: [], params: [], layer: 0 }],
};

const RESULT: SimulationResult = {
  state_vector: [],
  probabilities: { '00': 0.5, '11': 0.5 },
  measurements: {},
  bloch_coords: [],
  execution_time_ms: 8,
};

describe('narrateParse', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null if snapshot is null (nothing to narrate)', async () => {
    const out = await narrateParse({ code: '', snapshot: null });
    expect(out).toBeNull();
  });

  it('returns null if call fails (graceful)', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: null, error: 'http_error' });
    const out = await narrateParse({ code: 'x', snapshot: SNAPSHOT });
    expect(out).toBeNull();
  });

  it('returns trimmed single-line narration on success', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({
      text: '  q0 is now in superposition.\nLine2 ignored  ',
      error: null,
    });
    const out = await narrateParse({ code: 'x', snapshot: SNAPSHOT });
    expect(out).toBe('q0 is now in superposition.');
  });

  it('includes framework + gate count in prompt', async () => {
    const spy = vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: 'ok', error: null });
    await narrateParse({ code: 'cirq.H(q0)', snapshot: SNAPSHOT });
    const call = spy.mock.calls[0][0];
    expect(call.user).toContain('cirq');
    expect(call.user).toContain('1 gate');
  });
});

describe('narrateResult', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('includes probability summary in prompt', async () => {
    const spy = vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: 'bell state', error: null });
    await narrateResult({ code: 'x', snapshot: SNAPSHOT, result: RESULT });
    const call = spy.mock.calls[0][0];
    expect(call.user).toContain('|00⟩');
    expect(call.user).toContain('50%');
  });
});
```

- [ ] **Step 2: Run — RED**

```bash
npm test -- --run src/services/narration.test.ts
```

- [ ] **Step 3: Implement**

Create `src/services/narration.ts`:

```typescript
import { callClaude } from './claudeClient';
import type { CircuitSnapshot, SimulationResult } from '../types/quantum';

const SYSTEM_PROMPT = `You are Dirac, a friendly quantum computing tutor embedded in an IDE. The student just changed their code. Your job is to narrate what their circuit is doing right now in ONE short sentence (max 120 characters). No preamble, no "here's what happened", just the observation. If there's nothing interesting yet, return an empty string.`;

function firstLine(text: string): string {
  const trimmed = text.trim();
  const nl = trimmed.indexOf('\n');
  return nl >= 0 ? trimmed.slice(0, nl).trim() : trimmed;
}

function summarizeGates(snapshot: CircuitSnapshot): string {
  const count = snapshot.gates.length;
  if (count === 0) return 'no gates yet';
  const types = [...new Set(snapshot.gates.map((g) => g.type))].slice(0, 6).join(', ');
  return `${count} gate${count === 1 ? '' : 's'} (${types})`;
}

function summarizeProbs(probs: Record<string, number>): string {
  const top = Object.entries(probs)
    .filter(([, p]) => p > 1e-6)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([s, p]) => `|${s}⟩ ${Math.round(p * 100)}%`)
    .join(', ');
  return top || '(no outcomes above threshold)';
}

export interface NarrateParseInput {
  code: string;
  snapshot: CircuitSnapshot | null;
}

export async function narrateParse(input: NarrateParseInput): Promise<string | null> {
  if (!input.snapshot) return null;
  const prompt = [
    `Framework: ${input.snapshot.framework}`,
    `Qubits: ${input.snapshot.qubit_count}, depth ${input.snapshot.depth}, ${summarizeGates(input.snapshot)}`,
    '',
    'Code:',
    input.code.slice(0, 1500),
  ].join('\n');

  const res = await callClaude({ system: SYSTEM_PROMPT, user: prompt, maxTokens: 120 });
  if (!res.text) return null;
  const line = firstLine(res.text);
  return line.length > 0 ? line : null;
}

export interface NarrateResultInput {
  code: string;
  snapshot: CircuitSnapshot | null;
  result: SimulationResult;
}

export async function narrateResult(input: NarrateResultInput): Promise<string | null> {
  const parts = [
    `Framework: ${input.snapshot?.framework ?? 'unknown'}`,
    `Qubits: ${input.snapshot?.qubit_count ?? '?'}`,
    `Probabilities: ${summarizeProbs(input.result.probabilities)}`,
    `Time: ${input.result.execution_time_ms}ms`,
    '',
    'Code:',
    input.code.slice(0, 1500),
  ];
  const res = await callClaude({ system: SYSTEM_PROMPT, user: parts.join('\n'), maxTokens: 120 });
  if (!res.text) return null;
  const line = firstLine(res.text);
  return line.length > 0 ? line : null;
}
```

- [ ] **Step 4: Run — GREEN**

```bash
npm test -- --run src/services/narration.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/services/narration.ts src/services/narration.test.ts
git commit -m "feat(ai): narration service — one-liner narrations on parse and run"
```

---

## Task 5: `errorRewrite` service (TDD)

**Files:**
- Create: `src/services/errorRewrite.ts`
- Create: `src/services/errorRewrite.test.ts`

- [ ] **Step 1: Write tests**

Create `src/services/errorRewrite.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rewritePythonError } from './errorRewrite';
import * as claudeClient from './claudeClient';

describe('rewritePythonError', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when callClaude fails (graceful)', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: null, error: 'no_api_key' });
    const out = await rewritePythonError({
      code: 'x', framework: 'cirq', traceback: 'Traceback...\nNameError: name "q0" is not defined',
    });
    expect(out).toBeNull();
  });

  it('parses JSON block from model response', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({
      text: '```json\n{"explanation":"You forgot to declare q0 before using it.","fix":"q0 = cirq.LineQubit(0)\\n"}\n```',
      error: null,
    });
    const out = await rewritePythonError({
      code: 'cirq.H(q0)', framework: 'cirq',
      traceback: 'NameError: name "q0" is not defined',
    });
    expect(out?.explanation).toContain('forgot');
    expect(out?.fix).toContain('LineQubit');
  });

  it('accepts bare JSON without markdown fence', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({
      text: '{"explanation":"exp","fix":null}',
      error: null,
    });
    const out = await rewritePythonError({
      code: '', framework: 'cirq', traceback: 'X',
    });
    expect(out?.explanation).toBe('exp');
    expect(out?.fix).toBeNull();
  });

  it('returns null on unparseable response', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: 'not json', error: null });
    const out = await rewritePythonError({ code: '', framework: 'cirq', traceback: 'X' });
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run — RED**

```bash
npm test -- --run src/services/errorRewrite.test.ts
```

- [ ] **Step 3: Implement**

Create `src/services/errorRewrite.ts`:

```typescript
import { callClaude } from './claudeClient';

const SYSTEM_PROMPT = `You are Dirac, a patient quantum computing tutor. A student's code hit an error. Rewrite the Python traceback into a ONE-PARAGRAPH concept-level explanation that a first-semester student can understand. Use quantum-computing vocabulary only when the student's code uses it. If a minimal correct fix exists, include it.

Respond ONLY with a JSON object matching this shape:
{"explanation": "string", "fix": "string or null"}

Do NOT include any other text before or after the JSON.`;

export interface RewriteInput {
  code: string;
  framework: string;
  traceback: string;
}

export interface RewrittenError {
  explanation: string;
  fix: string | null;
}

function extractJson(raw: string): unknown | null {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenceMatch ? fenceMatch[1].trim() : raw.trim();
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export async function rewritePythonError(input: RewriteInput): Promise<RewrittenError | null> {
  const userPrompt = [
    `Framework: ${input.framework}`,
    '',
    'Student code:',
    input.code.slice(0, 2000),
    '',
    'Traceback:',
    input.traceback.slice(0, 2500),
  ].join('\n');

  const res = await callClaude({ system: SYSTEM_PROMPT, user: userPrompt, maxTokens: 500 });
  if (!res.text) return null;

  const parsed = extractJson(res.text);
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const explanation = obj.explanation;
  if (typeof explanation !== 'string' || explanation.length === 0) return null;

  const fixRaw = obj.fix;
  const fix = typeof fixRaw === 'string' && fixRaw.length > 0 ? fixRaw : null;
  return { explanation, fix };
}
```

- [ ] **Step 4: Run — GREEN**

```bash
npm test -- --run src/services/errorRewrite.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/services/errorRewrite.ts src/services/errorRewrite.test.ts
git commit -m "feat(ai): errorRewrite service — concept-level explanations for Python tracebacks"
```

---

## Task 6: Extend `diracStore` for ambient feed + rewritten error

**Files:**
- Modify: `src/stores/diracStore.ts`

- [ ] **Step 1: Read current shape**

```bash
grep -n "interface\|create\|apiKey" src/stores/diracStore.ts | head -20
```

- [ ] **Step 2: Add ambient feed + rewritten error state**

Add to the state interface and initializer:

```typescript
// Types
export interface AmbientMessage {
  id: string;
  kind: 'parse' | 'result';
  text: string;
  timestamp: number;
}

export interface StoredRewrittenError {
  explanation: string;
  fix: string | null;
  originalTraceback: string;
  timestamp: number;
}

// State additions
ambientFeed: AmbientMessage[];
rewrittenError: StoredRewrittenError | null;
pushAmbient(msg: Omit<AmbientMessage, 'id' | 'timestamp'>): void;
clearAmbient(): void;
setRewrittenError(err: Omit<StoredRewrittenError, 'timestamp'>): void;
clearRewrittenError(): void;
```

In the store initializer:

```typescript
ambientFeed: [],
rewrittenError: null,
pushAmbient: (msg) => set((s) => ({
  ambientFeed: [
    ...s.ambientFeed.slice(-4), // cap at last 5
    { ...msg, id: crypto.randomUUID(), timestamp: Date.now() },
  ],
})),
clearAmbient: () => set({ ambientFeed: [] }),
setRewrittenError: (err) => set({ rewrittenError: { ...err, timestamp: Date.now() } }),
clearRewrittenError: () => set({ rewrittenError: null }),
```

- [ ] **Step 3: Add a short test file**

Create `src/stores/diracStore.ambient.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useDiracStore } from './diracStore';

describe('diracStore ambient feed', () => {
  beforeEach(() => {
    useDiracStore.setState({ ambientFeed: [], rewrittenError: null });
  });

  it('starts empty', () => {
    expect(useDiracStore.getState().ambientFeed).toEqual([]);
    expect(useDiracStore.getState().rewrittenError).toBeNull();
  });

  it('pushAmbient appends with id + timestamp', () => {
    useDiracStore.getState().pushAmbient({ kind: 'parse', text: 'hello' });
    const feed = useDiracStore.getState().ambientFeed;
    expect(feed).toHaveLength(1);
    expect(feed[0].text).toBe('hello');
    expect(typeof feed[0].id).toBe('string');
    expect(typeof feed[0].timestamp).toBe('number');
  });

  it('caps the feed at 5 most recent entries', () => {
    for (let i = 0; i < 8; i++) {
      useDiracStore.getState().pushAmbient({ kind: 'parse', text: `m${i}` });
    }
    const feed = useDiracStore.getState().ambientFeed;
    expect(feed).toHaveLength(5);
    expect(feed[0].text).toBe('m3');
    expect(feed[4].text).toBe('m7');
  });

  it('setRewrittenError attaches a timestamp', () => {
    useDiracStore.getState().setRewrittenError({
      explanation: 'why',
      fix: null,
      originalTraceback: 'X',
    });
    const e = useDiracStore.getState().rewrittenError;
    expect(e?.explanation).toBe('why');
    expect(typeof e?.timestamp).toBe('number');
  });

  it('clearRewrittenError nulls it out', () => {
    useDiracStore.getState().setRewrittenError({ explanation: 'w', fix: null, originalTraceback: 'X' });
    useDiracStore.getState().clearRewrittenError();
    expect(useDiracStore.getState().rewrittenError).toBeNull();
  });
});
```

- [ ] **Step 4: Run — GREEN**

```bash
npm test -- --run src/stores/diracStore.ambient.test.ts
```

Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/stores/diracStore.ts src/stores/diracStore.ambient.test.ts
git commit -m "feat(dirac): ambient feed + rewritten error state"
```

---

## Task 7: Wire `useKernel` to dispatch narration + error rewrite

**Files:**
- Modify: `src/hooks/useKernel.ts`

- [ ] **Step 1: Imports**

Add at the top of `useKernel.ts`:

```typescript
import { narrateParse, narrateResult } from '../services/narration';
import { rewritePythonError } from '../services/errorRewrite';
import { useDiracStore } from '../stores/diracStore';
import { useSettingsStore } from '../stores/settingsStore';
```

(If `useSettingsStore` is already imported, don't duplicate.)

- [ ] **Step 2: On snapshot event, narrate asynchronously**

In `handleMessage` inside the `case 'snapshot':` branch, at the end of the existing code, add:

```typescript
        if (msg.data && useSettingsStore.getState().ai?.narration?.enabled) {
          const code = useEditorStore.getState().code;
          narrateParse({ code, snapshot: msg.data })
            .then((line) => {
              if (line) useDiracStore.getState().pushAmbient({ kind: 'parse', text: line });
            })
            .catch(() => { /* graceful */ });
        }
```

- [ ] **Step 3: On result, narrate**

In the `case 'result':` branch, append:

```typescript
        if (msg.data && useSettingsStore.getState().ai?.narration?.enabled) {
          const code = useEditorStore.getState().code;
          const snapshot = useCircuitStore.getState().snapshot;
          narrateResult({ code, snapshot, result: msg.data })
            .then((line) => {
              if (line) useDiracStore.getState().pushAmbient({ kind: 'result', text: line });
            })
            .catch(() => { /* graceful */ });
        }
```

- [ ] **Step 4: On error, rewrite**

In the `case 'error':` branch (inside the block after `addOutput`), add:

```typescript
        if (useSettingsStore.getState().ai?.errorRewrite?.enabled) {
          const code = useEditorStore.getState().code;
          const framework = useEditorStore.getState().framework;
          rewritePythonError({ code, framework, traceback: detail })
            .then((rewritten) => {
              if (rewritten) {
                useDiracStore.getState().setRewrittenError({
                  explanation: rewritten.explanation,
                  fix: rewritten.fix,
                  originalTraceback: detail,
                });
              }
            })
            .catch(() => { /* graceful */ });
        }
```

Also, on snapshot+result success branches, add `useDiracStore.getState().clearRewrittenError()` to tidy up past errors when the next thing succeeds.

- [ ] **Step 5: Build + unit tests**

```bash
npm run build:web 2>&1 | tail -3
npm test -- --run
```

Expected: build green, all tests pass (including prior suites).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useKernel.ts
git commit -m "feat(kernel): dispatch narration on parse/run + error rewrite on failure"
```

---

## Task 8: Render ambient feed in DiracSidePanel

**Files:**
- Modify: `src/components/dirac/DiracSidePanel.tsx`

- [ ] **Step 1: Read the component**

```bash
wc -l src/components/dirac/DiracSidePanel.tsx
grep -n "export function\|return" src/components/dirac/DiracSidePanel.tsx | head -10
```

- [ ] **Step 2: Add an ambient strip**

At the top of the main content area (above the chat scroll), render the ambient feed as a dim vertical stack. Use the store directly:

```tsx
import { useDiracStore } from '../../stores/diracStore';

// inside the component:
const ambientFeed = useDiracStore((s) => s.ambientFeed);
const colors = useThemeStore((s) => s.colors);

// render (place above chat history, below header):
{ambientFeed.length > 0 && (
  <div style={{
    padding: '6px 10px',
    borderBottom: `1px solid ${colors.border}`,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    maxHeight: 120,
    overflow: 'hidden',
  }}>
    {ambientFeed.slice(-5).map((msg) => (
      <div
        key={msg.id}
        title={new Date(msg.timestamp).toLocaleTimeString()}
        style={{
          fontSize: 11,
          color: colors.textDim,
          lineHeight: 1.4,
          fontFamily: "'Geist Sans', sans-serif",
          opacity: 0.9,
        }}
      >
        <span style={{ color: colors.accentLight, marginRight: 6 }}>·</span>
        {msg.text}
      </div>
    ))}
  </div>
)}
```

If `useThemeStore` isn't already imported in this file, add the import.

- [ ] **Step 3: Build + test**

```bash
npm run build:web 2>&1 | tail -3
npm test -- --run
```

- [ ] **Step 4: Commit**

```bash
git add src/components/dirac/DiracSidePanel.tsx
git commit -m "feat(dirac): render ambient narration feed in side panel"
```

---

## Task 9: Render rewritten error in TerminalPanel

**Files:**
- Modify: `src/components/layout/PanelLayout.tsx` (the `TerminalPanel` function)

- [ ] **Step 1: Read current TerminalPanel**

Look at the existing function at `src/components/layout/PanelLayout.tsx`. It renders `useSimulationStore((s) => s.terminalOutput)` inside a scroll area.

- [ ] **Step 2: Render a rewritten error banner above raw output**

Replace the TerminalPanel body (keep the signature) with:

```tsx
function TerminalPanel() {
  const { terminalOutput } = useSimulationStore();
  const rewritten = useDiracStore((s) => s.rewrittenError);
  const clearRewrittenError = useDiracStore((s) => s.clearRewrittenError);
  const setCode = useEditorStore((s) => s.setCode);
  const colors = useThemeStore((s) => s.colors);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [terminalOutput, rewritten]);

  return (
    <div ref={scrollRef} style={{ height: '100%', overflow: 'auto', fontFamily: "'Geist Mono', 'JetBrains Mono', monospace", fontSize: 12, color: colors.text, padding: '8px 12px' }}>
      {rewritten && (
        <div
          role="alert"
          style={{
            marginBottom: 10,
            padding: '10px 12px',
            border: `1px solid ${colors.dirac}40`,
            borderRadius: 10,
            background: `${colors.dirac}12`,
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 12,
            lineHeight: 1.5,
            color: colors.text,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: colors.dirac, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>
            Dirac
          </div>
          <div style={{ marginBottom: rewritten.fix ? 10 : 0 }}>{rewritten.explanation}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {rewritten.fix && (
              <button
                onClick={() => { setCode(rewritten.fix!); clearRewrittenError(); }}
                style={{
                  background: colors.dirac, color: '#fff', border: 'none',
                  borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', fontFamily: "'Geist Sans', sans-serif",
                }}
              >Apply fix</button>
            )}
            <button
              onClick={clearRewrittenError}
              style={{
                background: 'transparent', color: colors.textDim, border: `1px solid ${colors.border}`,
                borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
                fontFamily: "'Geist Sans', sans-serif",
              }}
            >Dismiss</button>
          </div>
        </div>
      )}
      {terminalOutput.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.textDim }}>
          &gt;_ Terminal output will appear here
        </div>
      ) : (
        terminalOutput.map((line, i) => (
          <div key={i} style={{ whiteSpace: 'pre-wrap', color: line.startsWith('Error') ? colors.error : colors.text }}>
            {line}
          </div>
        ))
      )}
    </div>
  );
}
```

Add the import `import { useDiracStore } from '../../stores/diracStore';` at the top if not present.

- [ ] **Step 3: Build + test**

```bash
npm run build:web 2>&1 | tail -3
npm test -- --run
```

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/PanelLayout.tsx
git commit -m "feat(terminal): render rewritten-error banner with Apply fix action"
```

---

## Task 10: Validate end-to-end + push

- [ ] **Step 1: Full test + build**

```bash
npm test -- --run && npm run build:web
```

Expected: all tests pass, web build green.

- [ ] **Step 2: Manual smoke**

```bash
pkill -f "vite preview" 2>/dev/null; true
BUILD_TARGET=web nohup npx vite preview --outDir dist-web > /tmp/nuclei-preview.log 2>&1 &
until grep -q "Local:" /tmp/nuclei-preview.log; do sleep 1; done
```

Open `http://localhost:4173/try/`, go through onboarding, then:

1. With no API key configured, type a gate. Expect: no ambient narration (graceful), editor still works.
2. Configure an API key in Settings (or skip this step if no key available — document result).
3. With key: type a gate, wait ~1s. Expect: a dim one-liner appears in Dirac sidebar describing the circuit.
4. Hit Run. Expect: a second one-liner about the result.
5. Intentionally break the code (e.g., rename `q0` to `q9`). Run. Expect: error rewrite banner appears at top of terminal with `Apply fix` and `Dismiss`.

- [ ] **Step 3: Push branch**

```bash
git push -u origin feat/ambient-ai
```

Report the PR URL.

---

## Spec coverage self-check

- Section 3 row "Narration": Tasks 4, 7, 8.
- Section 3 row "Error rewrite": Tasks 5, 7, 9.
- Section 3 settings toggles: Task 3.
- Section 6 graceful degradation: `claudeClient` returns early on missing API key; every service returns null on failure; `useKernel` wraps calls in `.catch()`; Task 10 Step 2.1 explicitly verifies no-key behavior.

## Out of scope for this plan

- Classifier for chat intent routing (Plan 3)
- Inline diff overlay (Plan 3)
- ⌘I compose modal (Plan 3)
- Ghost completion (Plan 4)
- Settings UI toggles visible in a Settings page (kept as programmatic state only — can ship UI later; defaults already on)
