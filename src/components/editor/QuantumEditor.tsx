import { useRef, useCallback, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { getExecute } from '../../App';
import { registerGhostCompletions } from './completions/ghostCompletions';
import { InlineEditWidget } from './inlineEdit/InlineEditWidget';

export function QuantumEditor() {
  const { code, setCode } = useEditorStore();
  const errors = useEditorStore((s) => s.errors);
  const mode = useThemeStore((s) => s.mode);
  const colors = useThemeStore((s) => s.colors);
  const editorSettings = useSettingsStore((s) => s.editor);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monacoRef = useRef<any>(null);
  const [showInlineEdit, setShowInlineEdit] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editorInstance, setEditorInstance] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [monacoInstance, setMonacoInstance] = useState<any>(null);

  const themeName = mode === 'dark' ? 'nuclei-dark' : 'nuclei-light';

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    setEditorInstance(editor);
    setMonacoInstance(monaco);

    editor.addAction({
      id: 'run-circuit',
      label: 'Run Circuit',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        const execute = getExecute();
        if (execute) execute();
      },
    });

    editor.addAction({
      id: 'inline-edit',
      label: 'Inline Edit (Cmd+K)',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: () => setShowInlineEdit(true),
    });

    // Register ghost completions
    registerGhostCompletions(monaco);

    editor.focus();
  };

  // Update Monaco theme when theme mode changes
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    if (mode === 'dark') {
      monaco.editor.defineTheme('nuclei-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '6A737D', fontStyle: 'italic' },
          { token: 'keyword', foreground: '00B4D8' },
          { token: 'string', foreground: '98C379' },
          { token: 'number', foreground: 'D19A66' },
          { token: 'type', foreground: '48CAE4' },
        ],
        colors: {
          'editor.background': '#0F1B2D',
          'editor.foreground': '#E0E0E0',
          'editor.lineHighlightBackground': '#1A2A42',
          'editor.selectionBackground': '#264F78',
          'editorCursor.foreground': '#00B4D8',
          'editorLineNumber.foreground': '#3D5A80',
          'editorLineNumber.activeForeground': '#00B4D8',
        },
      });
    } else {
      monaco.editor.defineTheme('nuclei-light', {
        base: 'vs',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '6A737D', fontStyle: 'italic' },
          { token: 'keyword', foreground: '0096B7' },
          { token: 'string', foreground: '22863A' },
          { token: 'number', foreground: 'B76E00' },
          { token: 'type', foreground: '005F73' },
        ],
        colors: {
          'editor.background': '#FAFBFC',
          'editor.foreground': '#1A1A2E',
          'editor.lineHighlightBackground': '#F0F2F5',
          'editor.selectionBackground': '#B4D7FF',
          'editorCursor.foreground': '#0096B7',
          'editorLineNumber.foreground': '#959DA5',
          'editorLineNumber.activeForeground': '#0096B7',
        },
      });
    }
    monaco.editor.setTheme(themeName);
  }, [mode, themeName]);

  // Update Monaco error markers when errors change
  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;

    const model = editor.getModel();
    if (!model) return;

    if (errors.length === 0) {
      monaco.editor.setModelMarkers(model, 'nuclei', []);
      return;
    }

    // Clamp line numbers to the valid range — kernel errors may reference
    // lines that no longer exist if the user kept typing after the error.
    const lineCount: number = model.getLineCount();
    const markers = errors
      .filter((err) => err.line >= 1 && err.line <= lineCount)
      .map((err) => ({
        severity: monaco.MarkerSeverity.Error,
        message: err.message,
        startLineNumber: err.line,
        startColumn: 1,
        endLineNumber: err.line,
        endColumn: model.getLineMaxColumn(err.line),
      }));
    monaco.editor.setModelMarkers(model, 'nuclei', markers);
  }, [errors]);

  const handleChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      setCode(value);
    }
  }, [setCode]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (file.name.endsWith('.py') || file.name.endsWith('.qasm')) {
      file.text().then((content) => setCode(content));
    }
  }, [setCode]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  return (
    <div
      style={{ width: '100%', height: '100%', backgroundColor: colors.bgEditor, position: 'relative' }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <Editor
        defaultLanguage="python"
        theme={themeName}
        value={code}
        onChange={handleChange}
        onMount={handleMount}
        options={{
          fontSize: editorSettings.fontSize,
          fontFamily: "'Fira Code', monospace",
          fontLigatures: true,
          minimap: { enabled: editorSettings.minimap },
          scrollBeyondLastLine: false,
          padding: { top: 16 },
          lineNumbers: editorSettings.lineNumbers ? 'on' : 'off',
          renderWhitespace: 'none',
          bracketPairColorization: { enabled: editorSettings.bracketPairColorization },
          automaticLayout: true,
          tabSize: editorSettings.tabSize,
          wordWrap: editorSettings.wordWrap ? 'on' : 'off',
          autoClosingBrackets: editorSettings.autoCloseBrackets ? 'always' : 'never',
          inlineSuggest: { enabled: true },
        }}
        beforeMount={(monaco) => {
          monaco.editor.defineTheme('nuclei-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [
              { token: 'comment', foreground: '6A737D', fontStyle: 'italic' },
              { token: 'keyword', foreground: '00B4D8' },
              { token: 'string', foreground: '98C379' },
              { token: 'number', foreground: 'D19A66' },
              { token: 'type', foreground: '48CAE4' },
            ],
            colors: {
              'editor.background': '#0F1B2D',
              'editor.foreground': '#E0E0E0',
              'editor.lineHighlightBackground': '#1A2A42',
              'editor.selectionBackground': '#264F78',
              'editorCursor.foreground': '#00B4D8',
              'editorLineNumber.foreground': '#3D5A80',
              'editorLineNumber.activeForeground': '#00B4D8',
            },
          });
          monaco.editor.defineTheme('nuclei-light', {
            base: 'vs',
            inherit: true,
            rules: [
              { token: 'comment', foreground: '6A737D', fontStyle: 'italic' },
              { token: 'keyword', foreground: '0096B7' },
              { token: 'string', foreground: '22863A' },
              { token: 'number', foreground: 'B76E00' },
              { token: 'type', foreground: '005F73' },
            ],
            colors: {
              'editor.background': '#FAFBFC',
              'editor.foreground': '#1A1A2E',
              'editor.lineHighlightBackground': '#F0F2F5',
              'editor.selectionBackground': '#B4D7FF',
              'editorCursor.foreground': '#0096B7',
              'editorLineNumber.foreground': '#959DA5',
              'editorLineNumber.activeForeground': '#0096B7',
            },
          });
        }}
      />
      {showInlineEdit && editorInstance && monacoInstance && (
        <InlineEditWidget
          editor={editorInstance}
          monaco={monacoInstance}
          onClose={() => setShowInlineEdit(false)}
        />
      )}
    </div>
  );
}
