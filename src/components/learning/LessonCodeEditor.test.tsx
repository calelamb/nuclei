// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, cleanup, act, screen } from '@testing-library/react';

const flag = vi.hoisted(() => {
  let value = false;
  const listeners = new Set<(next: boolean) => void>();
  return {
    get: () => value,
    set: (next: boolean) => { value = next; listeners.forEach((l) => l(next)); },
    subscribe: (l: (next: boolean) => void) => { listeners.add(l); return { dispose: () => { listeners.delete(l); } }; },
    reset: () => { value = false; listeners.clear(); },
  };
});

vi.mock('./lessonTabFocus', () => ({ lessonTabFocus: flag }));

interface FakeEditor {
  addAction: ReturnType<typeof vi.fn>;
  onDidFocusEditorText: (cb: () => void) => void;
  onDidBlurEditorText: (cb: () => void) => void;
  onDidContentSizeChange: (cb: () => void) => void;
  onDidDispose: (cb: () => void) => void;
  getContentHeight: () => number;
}

const harness = vi.hoisted(() => ({ focus: () => {}, blur: () => {}, options: {} as Record<string, unknown> }));

function FakeMonaco({ onMount, options }: { onMount: (e: FakeEditor, m: unknown) => void; options?: Record<string, unknown> }) {
  // Like the real component, mount the editor once, not on every re-render.
  React.useEffect(() => {
    harness.options = options ?? {};
    const editor: FakeEditor = {
      addAction: vi.fn(),
      onDidFocusEditorText: (cb) => { harness.focus = cb; },
      onDidBlurEditorText: (cb) => { harness.blur = cb; },
      onDidContentSizeChange: () => {},
      onDidDispose: () => {},
      getContentHeight: () => 100,
    };
    onMount(editor, { KeyMod: { WinCtrl: 1, CtrlCmd: 2 }, KeyCode: { KeyM: 4 } });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
vi.mock('@monaco-editor/react', () => ({ default: FakeMonaco }));
vi.mock('../editor/monacoThemes', () => ({ registerNucleiThemes: () => {} }));

import { LessonCodeEditor } from './LessonCodeEditor';

beforeEach(() => flag.reset());
afterEach(cleanup);

describe('LessonCodeEditor keyboard model (LR-03)', () => {
  it('makes Tab move focus while the editor is focused, then restores the previous mode', () => {
    render(<LessonCodeEditor value="x = 1" onChange={() => {}} />);
    expect(flag.get()).toBe(false);
    act(() => harness.focus());
    expect(flag.get()).toBe(true);
    act(() => harness.blur());
    expect(flag.get()).toBe(false);
  });

  it('shows the Tab hint only while the editor has focus', () => {
    render(<LessonCodeEditor value="x = 1" onChange={() => {}} />);
    expect(screen.queryByRole('note')).toBeNull();
    act(() => harness.focus());
    expect(screen.getByRole('note').textContent).toMatch(/Tab moves focus/);
    act(() => harness.blur());
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('follows the real flag when the learner toggles it to indent', () => {
    render(<LessonCodeEditor value="x = 1" onChange={() => {}} />);
    act(() => harness.focus());
    act(() => flag.set(false));
    expect(screen.getByRole('note').textContent).toMatch(/Tab indents/);
  });
});

describe('LessonCodeEditor gutter', () => {
  it('keeps line numbers off the card border with an inset gutter and room for three digits', () => {
    render(<LessonCodeEditor value="x = 1" onChange={() => {}} />);
    expect(harness.options.glyphMargin).toBe(true);
    expect(harness.options.lineNumbersMinChars).toBeGreaterThanOrEqual(3);
  });
});
