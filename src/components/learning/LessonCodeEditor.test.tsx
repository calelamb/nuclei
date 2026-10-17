// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act, screen } from '@testing-library/react';

interface FakeEditor {
  updateOptions: ReturnType<typeof vi.fn>;
  addCommand: ReturnType<typeof vi.fn>;
  onDidFocusEditorText: (cb: () => void) => void;
  onDidBlurEditorText: (cb: () => void) => void;
  onDidContentSizeChange: (cb: () => void) => void;
  getContentHeight: () => number;
}

const harness = vi.hoisted(() => ({
  editor: null as unknown as FakeEditor,
  focus: () => {},
  blur: () => {},
  toggle: () => {},
}));

vi.mock('@monaco-editor/react', () => ({
  default: ({ onMount }: { onMount: (e: FakeEditor, m: unknown) => void }) => {
    const editor: FakeEditor = {
      updateOptions: vi.fn(),
      addCommand: vi.fn((_key: number, cb: () => void) => { harness.toggle = cb; }),
      onDidFocusEditorText: (cb) => { harness.focus = cb; },
      onDidBlurEditorText: (cb) => { harness.blur = cb; },
      onDidContentSizeChange: () => {},
      getContentHeight: () => 100,
    };
    harness.editor = editor;
    onMount(editor, { KeyMod: { WinCtrl: 1, CtrlCmd: 2 }, KeyCode: { KeyM: 4 } });
    return null;
  },
}));
vi.mock('../editor/monacoThemes', () => ({ registerNucleiThemes: () => {} }));

import { LessonCodeEditor } from './LessonCodeEditor';

afterEach(cleanup);

describe('LessonCodeEditor keyboard model (LR-03)', () => {
  it('starts with Tab moving focus so keyboard users are not trapped', () => {
    render(<LessonCodeEditor value="x = 1" onChange={() => {}} />);
    expect(harness.editor.updateOptions).toHaveBeenCalledWith({ tabFocusMode: true });
  });

  it('shows the Tab hint only while the editor has focus', () => {
    render(<LessonCodeEditor value="x = 1" onChange={() => {}} />);
    expect(screen.queryByRole('note')).toBeNull();
    act(() => harness.focus());
    expect(screen.getByRole('note').textContent).toMatch(/Tab moves focus/);
    act(() => harness.blur());
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('toggles to Tab-indents with the registered shortcut', () => {
    render(<LessonCodeEditor value="x = 1" onChange={() => {}} />);
    act(() => harness.focus());
    act(() => harness.toggle());
    expect(harness.editor.updateOptions).toHaveBeenLastCalledWith({ tabFocusMode: false });
    expect(screen.getByRole('note').textContent).toMatch(/Tab indents/);
  });
});
