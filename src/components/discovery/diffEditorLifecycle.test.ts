import { describe, expect, it, vi } from 'vitest';
import { attachDiffEditor, type DiffEditorLike } from './diffEditorLifecycle';

function fakeEditor(changes: Array<{ modifiedStartLineNumber: number }> | null) {
  const calls: string[] = [];
  let listener: () => void = () => undefined;
  const reveal = vi.fn((line: number) => calls.push(`reveal:${line}`));
  const editor: DiffEditorLike = {
    getModel: () => ({ original: { dispose: () => calls.push('dispose:original') }, modified: { dispose: () => calls.push('dispose:modified') } }),
    setModel: () => calls.push('setModel:null'),
    getLineChanges: () => changes,
    getModifiedEditor: () => ({ revealLineInCenter: reveal }),
    onDidUpdateDiff: (l) => {
      listener = l;
      return { dispose: () => calls.push('unsubscribe') };
    },
  };
  return { editor, calls, fire: () => listener() };
}

describe('attachDiffEditor', () => {
  it('resets the widget model before disposing the text models', () => {
    const { editor, calls } = fakeEditor(null);
    attachDiffEditor(editor)();
    expect(calls.indexOf('setModel:null')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('setModel:null')).toBeLessThan(calls.indexOf('dispose:original'));
    expect(calls.indexOf('setModel:null')).toBeLessThan(calls.indexOf('dispose:modified'));
  });

  it('is idempotent and survives an already-disposed widget', () => {
    const { editor, calls } = fakeEditor(null);
    editor.setModel = () => { throw new Error('disposed'); };
    const dispose = attachDiffEditor(editor);
    expect(() => { dispose(); dispose(); }).not.toThrow();
    expect(calls.filter((c) => c === 'dispose:original')).toHaveLength(1);
  });

  it('reveals the first change once the diff has computed', () => {
    const { editor, calls, fire } = fakeEditor(null);
    attachDiffEditor(editor);
    expect(calls).not.toContain('reveal:42');
    editor.getLineChanges = () => [{ modifiedStartLineNumber: 42 }, { modifiedStartLineNumber: 90 }];
    fire();
    fire();
    expect(calls.filter((c) => c.startsWith('reveal'))).toEqual(['reveal:42']);
  });
});
