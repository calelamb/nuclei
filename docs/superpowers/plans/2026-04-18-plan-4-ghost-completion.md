# Plan 4 — Ghost Completion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cursor-style inline predictive suggestions that understand quantum semantics. Student pauses typing, a grey suggestion appears, Tab accepts it.

**Architecture:** A new `ghost` service asks Haiku for a one-line continuation given the current code + framework. A Monaco `InlineCompletionsProvider` registered from `QuantumEditor` calls that service with a 400 ms debounce. The provider is only active when `settings.dirac.ghostCompletions` is true (default off for beginners).

**Tech Stack:** Monaco Editor + Anthropic Messages API (Haiku) + Zustand.

**Branch:** `feat/ghost-completion`.

**Source spec:** `docs/superpowers/specs/2026-04-18-ai-native-progressive-reveal-design.md` section 3 row "Ghost completion".

---

## Task 1: Cut branch + baseline

- [ ] Step 1

```bash
cd "/Users/calelamb/Desktop/personal projects/nuclei"
git checkout -b feat/ghost-completion
```

- [ ] Step 2: baseline

```bash
npm test -- --run
```

Expected: 77 pass.

---

## Task 2: `ghost` service (TDD)

**Files:**
- Create: `src/services/ghost.ts`
- Create: `src/services/ghost.test.ts`

The service takes `{ code, prefix, framework }` where `prefix` is the text from the start of the file up to the cursor. It returns the suggested continuation (one line max, no explanation).

- [ ] Step 1: Test

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ghostCompletion } from './ghost';
import * as claudeClient from './claudeClient';

describe('ghostCompletion', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when claude fails', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: null, error: 'no_api_key' });
    const out = await ghostCompletion({ prefix: 'import cirq\nq0 = ', framework: 'cirq' });
    expect(out).toBeNull();
  });

  it('returns a single line trimmed', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({
      text: 'cirq.LineQubit(0)\n# (ignored)',
      error: null,
    });
    const out = await ghostCompletion({ prefix: 'import cirq\nq0 = ', framework: 'cirq' });
    expect(out).toBe('cirq.LineQubit(0)');
  });

  it('strips a leading code fence if the model hallucinates one', async () => {
    vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({
      text: '```python\ncirq.H(q0)\n```',
      error: null,
    });
    const out = await ghostCompletion({ prefix: '', framework: 'cirq' });
    expect(out).toBe('cirq.H(q0)');
  });

  it('returns null on empty prefix (nothing to complete)', async () => {
    const spy = vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: 'x', error: null });
    const out = await ghostCompletion({ prefix: '', framework: 'cirq' });
    expect(out).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('includes the framework in the prompt', async () => {
    const spy = vi.spyOn(claudeClient, 'callClaude').mockResolvedValue({ text: 'x', error: null });
    await ghostCompletion({ prefix: 'q = ', framework: 'qiskit' });
    expect(spy.mock.calls[0][0].user).toContain('qiskit');
  });
});
```

- [ ] Step 2: RED

```bash
npm test -- --run src/services/ghost.test.ts
```

- [ ] Step 3: Implement

```typescript
import { callClaude } from './claudeClient';

const SYSTEM_PROMPT = `You are a code completion engine for a quantum computing IDE. The student is mid-line in a Python file targeting a quantum framework. Complete the NEXT single line of code. Output ONLY the code — no explanation, no markdown fences, no trailing comments. If no useful completion is possible, output an empty string.`;

function stripFence(text: string): string {
  const fenceMatch = text.match(/```(?:python)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  return text.trim();
}

function firstLine(text: string): string {
  const nl = text.indexOf('\n');
  return nl >= 0 ? text.slice(0, nl).trim() : text.trim();
}

export interface GhostInput {
  prefix: string;
  framework: string;
}

export async function ghostCompletion(input: GhostInput): Promise<string | null> {
  if (input.prefix.trim().length === 0) return null;

  const userPrompt = [
    `Framework: ${input.framework}`,
    '',
    'Prefix (cursor is at the end):',
    '```python',
    input.prefix.slice(-2000),
    '```',
  ].join('\n');

  const res = await callClaude({ system: SYSTEM_PROMPT, user: userPrompt, maxTokens: 80 });
  if (!res.text) return null;
  const stripped = stripFence(res.text);
  const line = firstLine(stripped);
  return line.length > 0 ? line : null;
}
```

- [ ] Step 4: GREEN

```bash
npm test -- --run src/services/ghost.test.ts
```

- [ ] Step 5: Commit

```bash
git add src/services/ghost.ts src/services/ghost.test.ts
git commit -m "feat(ai): ghost completion service (Haiku one-line suggestions)"
```

---

## Task 3: Monaco inline completion provider

**Files:**
- Create: `src/components/editor/ghostProvider.ts`

Monaco exposes `languages.registerInlineCompletionsProvider`. Our provider delegates to `ghostCompletion`. Debounce is handled externally: we cache the latest request token and abort stale work.

- [ ] Step 1: Create provider factory

```typescript
import type * as monaco from 'monaco-editor';
import { ghostCompletion } from '../../services/ghost';
import { useEditorStore } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';

const DEBOUNCE_MS = 400;
let lastInvocation = 0;

export function registerGhostProvider(m: typeof monaco) {
  return m.languages.registerInlineCompletionsProvider('python', {
    async provideInlineCompletions(model, position) {
      if (!useSettingsStore.getState().dirac.ghostCompletions) {
        return { items: [] };
      }

      // Debounce: only run if 400ms has elapsed since the last call.
      const now = Date.now();
      lastInvocation = now;
      await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
      if (lastInvocation !== now) {
        return { items: [] };
      }

      const prefix = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const framework = useEditorStore.getState().framework;
      const suggestion = await ghostCompletion({ prefix, framework });
      if (!suggestion) return { items: [] };

      return {
        items: [
          {
            insertText: suggestion,
            range: {
              startLineNumber: position.lineNumber,
              startColumn: position.column,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            },
          },
        ],
      };
    },
    freeInlineCompletions() { /* no-op */ },
  });
}
```

- [ ] Step 2: Build

```bash
npm run build:web 2>&1 | tail -3
```

- [ ] Step 3: Commit

```bash
git add src/components/editor/ghostProvider.ts
git commit -m "feat(editor): Monaco inline completions provider backed by ghost service"
```

---

## Task 4: Register provider in QuantumEditor

**Files:**
- Modify: `src/components/editor/QuantumEditor.tsx`

- [ ] Step 1: Locate the editor mount

```bash
grep -n "onMount\|editor\.onMount\|handleEditorDidMount\|onBeforeMount\|beforeMount" src/components/editor/QuantumEditor.tsx | head -10
```

- [ ] Step 2: In the editor mount handler, register the provider once

Inside the Monaco `onMount` / `handleEditorDidMount` callback:

```typescript
import { registerGhostProvider } from './ghostProvider';

// inside onMount(editor, m):
const ghostDisposable = registerGhostProvider(m);
// The editor component should return a cleanup that disposes this on unmount:
return () => ghostDisposable.dispose();
```

If the editor component's mount handler does not already return a disposable cleanup, wire it via a ref + `useEffect` cleanup that tracks the disposable.

- [ ] Step 3: Build + unit tests

```bash
npm test -- --run && npm run build:web 2>&1 | tail -3
```

- [ ] Step 4: Commit

```bash
git add src/components/editor/QuantumEditor.tsx
git commit -m "feat(editor): register ghost inline completions on editor mount"
```

---

## Task 5: Validate + push

- [ ] Step 1: Green

```bash
npm test -- --run && npm run build:web 2>&1 | tail -3
```

- [ ] Step 2: Manual smoke

1. Enable ghost in Settings (`useSettingsStore.getState().updateDirac({ ghostCompletions: true })` from devtools if no UI toggle yet).
2. Configure API key.
3. Type part of a Cirq circuit, pause 500 ms.
4. Expect a grey inline suggestion after the cursor. Tab accepts, Esc dismisses.

If no API key: no suggestions, no errors.

- [ ] Step 3: Push

```bash
git push -u origin feat/ghost-completion
```

---

## Spec coverage

- Section 3 row "Ghost completion": Tasks 2, 3, 4.
- Section 3 beginner-safe default: Task 3 gates the provider on `settings.dirac.ghostCompletions`, which was set to false in Plan 2.
- Section 6 graceful degradation: `ghostCompletion` returns null without API key; provider returns empty items.

## Out of scope

- A Settings UI toggle for ghost (user can still flip it via programmatic setting or a future Settings page).
- Multi-line completions — v1 is one line.
- Telemetry on accept/reject.
