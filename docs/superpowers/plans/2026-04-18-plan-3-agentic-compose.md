# Plan 3 — Agentic Compose (⌘I + diff overlay)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Create a Bell state" → Dirac writes the code in the editor. Full Cursor Composer parity: ⌘I opens a quick-ask modal, a Sonnet tool-use call produces code, user sees a preview and presses Enter to apply or Esc to reject.

**Architecture:** A `classify` service routes chat messages into compose vs explain. A `compose` service wraps `claudeClient` with Sonnet + an `insert_code` tool, extracts the proposed code and explanation, and returns them. A `ComposeModal` component (triggered by ⌘I) gathers the user's intent and renders a `DiffPreview` with the proposed code. On Accept, the editor buffer is replaced. On Reject, nothing changes. Every compose call is a no-op without an API key.

**Tech Stack:** React 19 + TypeScript + Zustand + Monaco + Anthropic Messages API (claude-sonnet-4-6).

**Branch:** `feat/agentic-compose`.

**Source spec:** `docs/superpowers/specs/2026-04-18-ai-native-progressive-reveal-design.md` — section 2.

---

## Task 1: Cut branch + baseline

- [ ] Step 1: Cut branch

```bash
cd "/Users/calelamb/Desktop/personal projects/nuclei"
git checkout -b feat/agentic-compose
```

- [ ] Step 2: Baseline

```bash
npm test -- --run
```

Expected: 65 tests pass.

---

## Task 2: Intent classifier (TDD)

**Files:**
- Create: `src/services/classify.ts`
- Create: `src/services/classify.test.ts`

- [ ] Step 1: Test

```typescript
import { describe, it, expect } from 'vitest';
import { classifyIntent } from './classify';

describe('classifyIntent', () => {
  it('routes explicit /compose prefix to compose', () => {
    expect(classifyIntent('/compose make a bell state').kind).toBe('compose');
  });

  it('routes /explain to explain', () => {
    expect(classifyIntent('/explain what does H do').kind).toBe('explain');
  });

  it('routes imperative code-gen phrasing to compose', () => {
    for (const s of [
      'create a 3-qubit GHZ state',
      'build me a bell circuit',
      'make a teleportation circuit',
      'write code for grover with 2 qubits',
      'generate a QFT on 4 qubits',
    ]) {
      expect(classifyIntent(s).kind).toBe('compose');
    }
  });

  it('leaves everything else as explain by default', () => {
    for (const s of [
      'what is entanglement?',
      'why is my circuit broken',
      'show me the bloch sphere for q0',
    ]) {
      expect(classifyIntent(s).kind).toBe('explain');
    }
  });

  it('strips the slash prefix from the returned prompt', () => {
    expect(classifyIntent('/compose make bell').prompt).toBe('make bell');
  });
});
```

- [ ] Step 2: Run — RED

```bash
npm test -- --run src/services/classify.test.ts
```

- [ ] Step 3: Implement

```typescript
export type Intent = { kind: 'compose' | 'explain'; prompt: string };

const COMPOSE_VERBS = /\b(create|build|make|write|generate|give me|implement)\b/i;
const COMPOSE_SUBJECTS = /\b(circuit|state|gate|qubit|algorithm|qft|grover|bell|ghz|teleport|shor)\b/i;

export function classifyIntent(raw: string): Intent {
  const trimmed = raw.trim();
  if (trimmed.startsWith('/compose')) {
    return { kind: 'compose', prompt: trimmed.replace(/^\/compose\s*/, '') };
  }
  if (trimmed.startsWith('/explain') || trimmed.startsWith('/think') || trimmed.startsWith('/fix')) {
    return { kind: 'explain', prompt: trimmed.replace(/^\/\w+\s*/, '') };
  }
  if (COMPOSE_VERBS.test(trimmed) && COMPOSE_SUBJECTS.test(trimmed)) {
    return { kind: 'compose', prompt: trimmed };
  }
  return { kind: 'explain', prompt: trimmed };
}
```

- [ ] Step 4: GREEN

```bash
npm test -- --run src/services/classify.test.ts
```

- [ ] Step 5: Commit

```bash
git add src/services/classify.ts src/services/classify.test.ts
git commit -m "feat(ai): chat intent classifier (compose vs explain)"
```

---

## Task 3: Compose service (TDD)

**Files:**
- Create: `src/services/compose.ts`
- Create: `src/services/compose.test.ts`

The compose service calls Sonnet with a single tool `insert_code`. We expect the model to respond with a tool_use block for `insert_code` containing the code as input. The wrapper extracts the code, plus the model's text explanation (if any).

- [ ] Step 1: Test

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compose } from './compose';
import { useDiracStore } from '../stores/diracStore';

describe('compose', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useDiracStore.setState({ apiKey: 'sk-test' });
  });

  it('returns null when no api key', async () => {
    useDiracStore.setState({ apiKey: '' });
    const out = await compose({ intent: 'make bell', framework: 'cirq', currentCode: '' });
    expect(out).toBeNull();
  });

  it('returns { code, explanation } when Sonnet uses the insert_code tool', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            { type: 'text', text: 'Here is a Bell state.' },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'insert_code',
              input: { code: 'import cirq\nq0, q1 = cirq.LineQubit.range(2)\n' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const out = await compose({ intent: 'make bell', framework: 'cirq', currentCode: '' });
    expect(out?.code).toContain('LineQubit');
    expect(out?.explanation).toContain('Bell');
  });

  it('returns null if no tool_use block', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'just chatting' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const out = await compose({ intent: 'make bell', framework: 'cirq', currentCode: '' });
    expect(out).toBeNull();
  });

  it('returns null on http error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const out = await compose({ intent: 'make bell', framework: 'cirq', currentCode: '' });
    expect(out).toBeNull();
  });
});
```

- [ ] Step 2: RED

```bash
npm test -- --run src/services/compose.test.ts
```

- [ ] Step 3: Implement

```typescript
import { useDiracStore } from '../stores/diracStore';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const SONNET_MODEL = 'claude-sonnet-4-6-20250514';

const SYSTEM_PROMPT = `You are Dirac, a quantum computing tutor that writes code for students.
You will receive:
- The target framework (cirq, qiskit, cuda-q)
- The student's current code (possibly empty)
- The student's request

ALWAYS respond with exactly one tool_use call to the \`insert_code\` tool. The \`code\` argument must be a COMPLETE, runnable Python file for the target framework. Keep it minimal — the student is learning. Include a short comment that says what the circuit does. Do not include any preamble text in the tool input.

Along with the tool call, include a ONE-SENTENCE plain-text explanation of what the code does.`;

const INSERT_CODE_TOOL = {
  name: 'insert_code',
  description: 'Insert a complete runnable Python program for the target quantum framework into the editor.',
  input_schema: {
    type: 'object' as const,
    properties: {
      code: { type: 'string' as const, description: 'The full contents of the new editor buffer.' },
    },
    required: ['code'],
  },
};

export interface ComposeInput {
  intent: string;
  framework: string;
  currentCode: string;
}

export interface ComposeOutput {
  code: string;
  explanation: string;
}

export async function compose(input: ComposeInput): Promise<ComposeOutput | null> {
  const apiKey = useDiracStore.getState().apiKey;
  if (!apiKey || !apiKey.trim()) return null;

  const userPrompt = [
    `Framework: ${input.framework}`,
    '',
    'Student request:',
    input.intent,
    '',
    'Current code (may be empty):',
    '```python',
    input.currentCode,
    '```',
  ].join('\n');

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
        model: SONNET_MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: [INSERT_CODE_TOOL],
        tool_choice: { type: 'tool', name: 'insert_code' },
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!response.ok) return null;

    const data = await response.json();
    const contentArr: Array<Record<string, unknown>> = Array.isArray(data?.content) ? data.content : [];

    const toolUse = contentArr.find((c) => c.type === 'tool_use' && c.name === 'insert_code');
    const codeRaw = (toolUse?.input as { code?: unknown } | undefined)?.code;
    if (typeof codeRaw !== 'string' || codeRaw.length === 0) return null;

    const explanationBlock = contentArr.find((c) => c.type === 'text');
    const explanation = typeof explanationBlock?.text === 'string' ? explanationBlock.text : '';

    return { code: codeRaw, explanation };
  } catch {
    return null;
  }
}
```

- [ ] Step 4: GREEN

```bash
npm test -- --run src/services/compose.test.ts
```

- [ ] Step 5: Commit

```bash
git add src/services/compose.ts src/services/compose.test.ts
git commit -m "feat(ai): compose service — Sonnet with insert_code tool"
```

---

## Task 4: Compose store slice

**Files:**
- Modify: `src/stores/diracStore.ts`

Add state for the pending compose preview:

```typescript
export interface ComposePreview {
  id: string;
  intent: string;
  code: string;            // proposed full buffer
  explanation: string;
  timestamp: number;
}

// In state interface:
composePreview: ComposePreview | null;
setComposePreview: (p: Omit<ComposePreview, 'id' | 'timestamp'>) => void;
clearComposePreview: () => void;

// In initializer:
composePreview: null,
setComposePreview: (p) => set({
  composePreview: { ...p, id: crypto.randomUUID(), timestamp: Date.now() },
}),
clearComposePreview: () => set({ composePreview: null }),
```

- [ ] Step 1: Apply the diff

Add these fields to `DiracState` interface and the `create` initializer in `src/stores/diracStore.ts`. Model after the ambient/rewritten patterns already in place.

- [ ] Step 2: Quick test

Create `src/stores/diracStore.compose.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useDiracStore } from './diracStore';

describe('diracStore compose preview', () => {
  beforeEach(() => useDiracStore.setState({ composePreview: null }));

  it('starts null', () => {
    expect(useDiracStore.getState().composePreview).toBeNull();
  });

  it('setComposePreview attaches id + timestamp', () => {
    useDiracStore.getState().setComposePreview({ intent: 'bell', code: 'x', explanation: 'e' });
    const p = useDiracStore.getState().composePreview!;
    expect(p.code).toBe('x');
    expect(typeof p.id).toBe('string');
    expect(typeof p.timestamp).toBe('number');
  });

  it('clearComposePreview nulls it', () => {
    useDiracStore.getState().setComposePreview({ intent: 'bell', code: 'x', explanation: 'e' });
    useDiracStore.getState().clearComposePreview();
    expect(useDiracStore.getState().composePreview).toBeNull();
  });
});
```

- [ ] Step 3: Run — GREEN

```bash
npm test -- --run src/stores/diracStore.compose.test.ts
```

- [ ] Step 4: Commit

```bash
git add src/stores/diracStore.ts src/stores/diracStore.compose.test.ts
git commit -m "feat(dirac): composePreview state"
```

---

## Task 5: ComposeModal component

**Files:**
- Create: `src/components/dirac/ComposeModal.tsx`

This is the ⌘I quick-ask. It renders a single text input at the top of the viewport, calls `compose()` on submit, and on success stores the result via `setComposePreview`. While loading, a small spinner appears. Esc closes. Enter submits.

- [ ] Step 1: Implement

```tsx
import { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, X, Loader2 } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useDiracStore } from '../../stores/diracStore';
import { useThemeStore } from '../../stores/themeStore';
import { compose } from '../../services/compose';

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
}

export function ComposeModal({ open, onClose }: ComposeModalProps) {
  const [intent, setIntent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const framework = useEditorStore((s) => s.framework);
  const currentCode = useEditorStore((s) => s.code);
  const setPreview = useDiracStore((s) => s.setComposePreview);

  useEffect(() => {
    if (open) {
      setIntent('');
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleSubmit = useCallback(async () => {
    const text = intent.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    const res = await compose({ intent: text, framework, currentCode });
    setLoading(false);
    if (!res) {
      setError('Couldn\'t compose. Is your API key set in Settings?');
      return;
    }
    setPreview({ intent: text, code: res.code, explanation: res.explanation });
    onClose();
  }, [intent, loading, framework, currentCode, setPreview, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        role="presentation"
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.35)',
          zIndex: 9998,
        }}
      />
      <div
        role="dialog"
        aria-label="Ask Dirac to write code"
        style={{
          position: 'fixed',
          top: '14vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(680px, 92vw)',
          background: colors.bgPanel,
          border: `1px solid ${colors.borderStrong}`,
          borderRadius: 12,
          boxShadow: shadow.lg,
          padding: 14,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          color: colors.dirac, fontSize: 11, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          <Sparkles size={14} />
          Dirac · Compose
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none', color: colors.textDim,
              cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center',
            }}
          ><X size={14} /></button>
        </div>
        <input
          ref={inputRef}
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
          }}
          placeholder="Describe what you want — e.g. 'a 3-qubit GHZ state'"
          style={{
            background: colors.bgElevated,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: '10px 12px',
            color: colors.text,
            fontSize: 14,
            fontFamily: "'Geist Sans', sans-serif",
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: colors.textDim }}>
          {loading && <><Loader2 size={12} style={{ animation: 'nuclei-spin 800ms linear infinite' }} /> Thinking…</>}
          {!loading && <span>Framework: <span style={{ color: colors.accentLight }}>{framework}</span> · Enter to submit · Esc to close</span>}
          {error && <span style={{ color: colors.error, marginLeft: 'auto' }}>{error}</span>}
        </div>
      </div>
    </>
  );
}
```

- [ ] Step 2: Build (no new test — behavior is covered in the integration test when we wire it in)

```bash
npm run build:web 2>&1 | tail -3
```

- [ ] Step 3: Commit

```bash
git add src/components/dirac/ComposeModal.tsx
git commit -m "feat(dirac): ComposeModal ⌘I quick-ask UI"
```

---

## Task 6: DiffPreview component

**Files:**
- Create: `src/components/editor/DiffPreview.tsx`

Renders a full-buffer diff (old vs new) as two monospaced columns side-by-side, with Accept / Reject / Revise buttons. Revision is deferred to Plan 4 polish — just Accept + Reject for v1, which already delivers Cursor-parity for the core "make me a circuit" flow.

- [ ] Step 1: Implement

```tsx
import { Check, X } from 'lucide-react';
import { useDiracStore } from '../../stores/diracStore';
import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';

export function DiffPreview() {
  const preview = useDiracStore((s) => s.composePreview);
  const clear = useDiracStore((s) => s.clearComposePreview);
  const setCode = useEditorStore((s) => s.setCode);
  const currentCode = useEditorStore((s) => s.code);
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);

  if (!preview) return null;

  const accept = () => {
    setCode(preview.code);
    clear();
  };
  const reject = () => {
    clear();
  };

  return (
    <div
      role="dialog"
      aria-label="Proposed code from Dirac"
      style={{
        position: 'fixed',
        top: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(880px, 94vw)',
        maxHeight: '72vh',
        background: colors.bgPanel,
        border: `1px solid ${colors.borderStrong}`,
        borderRadius: 12,
        boxShadow: shadow.lg,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: "'Geist Sans', sans-serif",
      }}
    >
      <div style={{
        padding: '10px 14px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ color: colors.dirac, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Dirac · Preview
        </span>
        <span style={{ color: colors.textDim, fontSize: 12 }}>“{preview.intent}”</span>
      </div>
      {preview.explanation && (
        <div style={{ padding: '8px 14px', color: colors.textMuted, fontSize: 12, borderBottom: `1px solid ${colors.border}` }}>
          {preview.explanation}
        </div>
      )}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        flex: 1,
        minHeight: 0,
      }}>
        <div style={{ borderRight: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '6px 12px', fontSize: 10, color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${colors.border}` }}>Current</div>
          <pre style={{
            margin: 0, padding: '10px 14px', overflow: 'auto', flex: 1,
            fontSize: 12, fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            color: colors.textMuted, background: `${colors.error}08`,
          }}>{currentCode || '(empty)'}</pre>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '6px 12px', fontSize: 10, color: colors.textDim, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${colors.border}` }}>Proposed</div>
          <pre style={{
            margin: 0, padding: '10px 14px', overflow: 'auto', flex: 1,
            fontSize: 12, fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            color: colors.text, background: `${colors.success}08`,
          }}>{preview.code}</pre>
        </div>
      </div>
      <div style={{
        padding: '10px 14px',
        borderTop: `1px solid ${colors.border}`,
        display: 'flex', gap: 8, justifyContent: 'flex-end',
      }}>
        <button
          onClick={reject}
          style={{
            background: 'transparent', color: colors.text,
            border: `1px solid ${colors.border}`, borderRadius: 8,
            padding: '6px 14px', cursor: 'pointer',
            fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6,
          }}
        ><X size={13} /> Reject <span style={{ color: colors.textDim, fontSize: 11 }}>Esc</span></button>
        <button
          onClick={accept}
          style={{
            background: colors.success, color: '#0a0f1a',
            border: 'none', borderRadius: 8,
            padding: '6px 14px', cursor: 'pointer',
            fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
          }}
        ><Check size={13} /> Apply <span style={{ opacity: 0.7, fontSize: 11 }}>↵</span></button>
      </div>
    </div>
  );
}
```

- [ ] Step 2: Keyboard wiring — make Enter accept + Esc reject

Add to the bottom of `DiffPreview`:

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (!preview) return;
    if (e.key === 'Escape') { e.preventDefault(); clear(); }
    else if (e.key === 'Enter') { e.preventDefault(); setCode(preview.code); clear(); }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [preview, clear, setCode]);
```

Add the import: `import { useEffect } from 'react';`.

- [ ] Step 3: Build

```bash
npm run build:web 2>&1 | tail -3
```

- [ ] Step 4: Commit

```bash
git add src/components/editor/DiffPreview.tsx
git commit -m "feat(editor): DiffPreview with accept/reject + keyboard shortcuts"
```

---

## Task 7: Wire ⌘I + render modal + diff at App level

**Files:**
- Modify: `src/App.tsx` (or whichever top-level component owns global keyboard shortcuts)

- [ ] Step 1: Read current structure

```bash
grep -n "⌘I\|cmdk\|composeModal\|keydown\|Cmd+I" src/App.tsx
```

- [ ] Step 2: Add ⌘I handler + render `ComposeModal` and `DiffPreview` at the root

Inside `App.tsx` after the existing effects:

```tsx
import { useEffect, useState } from 'react';
import { ComposeModal } from './components/dirac/ComposeModal';
import { DiffPreview } from './components/editor/DiffPreview';

// inside the App component:
const [composeOpen, setComposeOpen] = useState(false);

useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    // ⌘I on mac, Ctrl+I elsewhere
    if ((e.metaKey || e.ctrlKey) && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault();
      setComposeOpen(true);
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, []);

// Render at the bottom of the App's JSX tree (inside root element):
<>
  <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} />
  <DiffPreview />
</>
```

(Merge into your existing JSX as appropriate — do NOT double-wrap if App already has fragments.)

- [ ] Step 3: Build + test

```bash
npm test -- --run && npm run build:web 2>&1 | tail -3
```

- [ ] Step 4: Commit

```bash
git add src/App.tsx
git commit -m "feat(app): ⌘I opens ComposeModal; DiffPreview overlays when a compose lands"
```

---

## Task 8: Route compose from Dirac chat

**Files:**
- Modify: `src/hooks/useDirac.ts` (look for `sendMessage`)

- [ ] Step 1: Find the sendMessage function

```bash
grep -n "sendMessage\|export function useDirac" src/hooks/useDirac.ts
```

- [ ] Step 2: At the start of `sendMessage`, route through the classifier

Insert near the top (before the existing Claude call for chat):

```typescript
import { classifyIntent } from '../services/classify';
import { compose } from '../services/compose';

// inside sendMessage:
const intent = classifyIntent(text);
if (intent.kind === 'compose') {
  useDiracStore.getState().addMessage({ role: 'user', content: text });
  useDiracStore.getState().setLoading(true);
  try {
    const framework = useEditorStore.getState().framework;
    const currentCode = useEditorStore.getState().code;
    const res = await compose({ intent: intent.prompt, framework, currentCode });
    if (res) {
      useDiracStore.getState().setComposePreview({
        intent: intent.prompt,
        code: res.code,
        explanation: res.explanation,
      });
      useDiracStore.getState().addMessage({
        role: 'assistant',
        content: res.explanation || 'Here is a draft — press Enter to apply.',
      });
    } else {
      useDiracStore.getState().addMessage({
        role: 'assistant',
        content: 'I couldn\'t draft code for that. Make sure your API key is set and try again.',
      });
    }
  } finally {
    useDiracStore.getState().setLoading(false);
  }
  return;
}
```

Keep the existing explain path below this short-circuit.

- [ ] Step 3: Build + test

```bash
npm test -- --run && npm run build:web 2>&1 | tail -3
```

- [ ] Step 4: Commit

```bash
git add src/hooks/useDirac.ts
git commit -m "feat(dirac): route compose-intent chat messages through compose service"
```

---

## Task 9: Validate + push

- [ ] Step 1: Full green

```bash
npm test -- --run && npm run build:web 2>&1 | tail -3
```

- [ ] Step 2: Manual smoke

Serve `dist-web` and open `/try/`. With an API key configured:
1. Press ⌘I. ComposeModal appears. Type "3-qubit GHZ state". Enter.
2. Expect loading spinner. Then DiffPreview overlays with current empty → proposed code.
3. Press Enter → buffer populated, circuit panel appears, Bloch sphere ready after Run.
4. Without API key: ComposeModal shows "Couldn't compose. Is your API key set in Settings?"
5. In Dirac chat, type "create a bell state". Expect: compose flow fires.

- [ ] Step 3: Push

```bash
git push -u origin feat/agentic-compose
```

Report the PR URL.

---

## Spec coverage self-check

- Section 2 (Agentic Dirac compose flow): Tasks 2, 3, 5, 6, 7, 8.
- Section 2 ⌘I entry: Task 7.
- Section 2 diff overlay with Accept/Reject/Esc: Task 6 + keyboard handler.
- Section 6 graceful degradation: `compose` returns null without API key; ComposeModal shows error; `DiffPreview` renders nothing when `composePreview` is null.

## Out of scope

- Streaming generation (deferred to polish)
- Revise button (deferred — close and re-open ⌘I for a second try)
- Multi-file compose
- Compose telemetry hooks
