import { useEffect, useRef } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useEditorRevealStore, clampRevealLine } from '../../stores/editorRevealStore';

type StandaloneEditor = monaco.editor.IStandaloneCodeEditor;

export const REVEAL_LINE_CLASS = 'nuclei-reveal-line';

/**
 * Honors `useEditorRevealStore` requests (click-to-source): scrolls the line
 * into view, moves the cursor there and highlights the whole line until the
 * buffer is next edited or another reveal replaces it.
 */
export function useRevealLine(editor: StandaloneEditor | null, monacoApi: Monaco | null): void {
  const request = useEditorRevealStore((s) => s.request);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    if (!editor) return;
    const sub = editor.onDidChangeModelContent(() => decorations.current?.clear());
    return () => sub.dispose();
  }, [editor]);

  useEffect(() => {
    if (!editor || !monacoApi || !request) return;
    const model = editor.getModel();
    if (!model) return;
    const line = clampRevealLine(request.line, model.getLineCount());
    editor.revealLineInCenterIfOutsideViewport(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    decorations.current?.clear();
    decorations.current = editor.createDecorationsCollection([
      {
        range: new monacoApi.Range(line, 1, line, model.getLineMaxColumn(line)),
        options: { isWholeLine: true, className: REVEAL_LINE_CLASS, linesDecorationsClassName: REVEAL_LINE_CLASS },
      },
    ]);
    editor.focus();
  }, [editor, monacoApi, request]);
}
