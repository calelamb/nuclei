// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRevealLine, REVEAL_LINE_CLASS } from './useRevealLine';
import { useEditorRevealStore } from '../../stores/editorRevealStore';

function fakeEditor(lineCount: number) {
  const clear = vi.fn();
  let onChange: () => void = () => undefined;
  const editor = {
    getModel: () => ({ getLineCount: () => lineCount, getLineMaxColumn: () => 12 }),
    onDidChangeModelContent: (cb: () => void) => {
      onChange = cb;
      return { dispose: vi.fn() };
    },
    revealLineInCenterIfOutsideViewport: vi.fn(),
    setPosition: vi.fn(),
    focus: vi.fn(),
    createDecorationsCollection: vi.fn(() => ({ clear })),
  };
  return { editor, clear, fireChange: () => onChange() };
}
const monacoApi = { Range: class { constructor(public a: number, public b: number, public c: number, public d: number) {} } };

beforeEach(() => useEditorRevealStore.getState().clear());

describe('useRevealLine', () => {
  it('scrolls, moves the cursor and highlights the whole line', () => {
    const { editor } = fakeEditor(20);
    renderHook(() => useRevealLine(editor as never, monacoApi as never));
    act(() => useEditorRevealStore.getState().revealLine(7));
    expect(editor.revealLineInCenterIfOutsideViewport).toHaveBeenCalledWith(7);
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 7, column: 1 });
    const decos = (editor.createDecorationsCollection.mock.calls[0] as unknown[][])[0] as Array<{ options: { isWholeLine: boolean; className: string } }>;
    expect(decos[0].options.isWholeLine).toBe(true);
    expect(decos[0].options.className).toBe(REVEAL_LINE_CLASS);
  });

  it('clamps a line beyond the buffer and clears the highlight on edit', () => {
    const { editor, clear, fireChange } = fakeEditor(5);
    renderHook(() => useRevealLine(editor as never, monacoApi as never));
    act(() => useEditorRevealStore.getState().revealLine(99));
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 5, column: 1 });
    fireChange();
    expect(clear).toHaveBeenCalled();
  });
});
