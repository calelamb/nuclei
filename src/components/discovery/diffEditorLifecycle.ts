/**
 * Monaco diff-editor lifecycle helpers. Kept free of React and of the monaco
 * package so they can be unit tested with plain fakes.
 */

interface TextModelLike {
  dispose: () => void;
}

interface LineChangeLike {
  modifiedStartLineNumber: number;
}

export interface DiffEditorLike {
  getModel: () => { original: TextModelLike; modified: TextModelLike } | null;
  setModel: (model: null) => void;
  getLineChanges: () => LineChangeLike[] | null;
  getModifiedEditor: () => { revealLineInCenter: (line: number) => void };
  onDidUpdateDiff: (listener: () => void) => { dispose: () => void };
}

/** Scroll the diff so the first changed hunk is visible instead of line 1. */
export function revealFirstChange(editor: DiffEditorLike): boolean {
  const first = editor.getLineChanges()?.[0];
  if (!first) return false;
  editor.getModifiedEditor().revealLineInCenter(Math.max(1, first.modifiedStartLineNumber));
  return true;
}

/**
 * Reveals the first change once the diff computes, and returns a disposer that
 * resets the widget's model BEFORE disposing the text models. Disposing models
 * first makes Monaco throw "TextModel got disposed before DiffEditorWidget
 * model got reset". Use with `keepCurrentOriginalModel` and `keepCurrentModifiedModel` so the wrapper does not dispose
 * the models in its own (wrong) order.
 */
export function attachDiffEditor(editor: DiffEditorLike): () => void {
  let revealed = false;
  const subscription = editor.onDidUpdateDiff(() => {
    if (!revealed) revealed = revealFirstChange(editor);
  });
  revealed = revealFirstChange(editor);
  // Captured now: by the time we dispose, the wrapper may already have disposed the widget.
  const model = editor.getModel();
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    subscription.dispose();
    try {
      editor.setModel(null);
    } catch {
      // The widget was already disposed; the models below still need releasing.
    }
    model?.original.dispose();
    model?.modified.dispose();
  };
}
