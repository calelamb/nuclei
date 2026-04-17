import { useRef, useCallback, useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { OnMount, Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { getExecute } from '../../App';
import { registerGhostCompletions } from './completions/ghostCompletions';
import { InlineEditWidget } from './inlineEdit/InlineEditWidget';
import { registerNucleiThemes } from './monacoThemes';

type StandaloneEditor = monaco.editor.IStandaloneCodeEditor;

export function QuantumEditor() {
  const { code, setCode } = useEditorStore();
  const errors = useEditorStore((s) => s.errors);
  const mode = useThemeStore((s) => s.mode);
  const colors = useThemeStore((s) => s.colors);
  const editorSettings = useSettingsStore((s) => s.editor);
  const editorRef = useRef<StandaloneEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const [showInlineEdit, setShowInlineEdit] = useState(false);
  const [editorInstance, setEditorInstance] = useState<StandaloneEditor | null>(null);
  const [monacoInstance, setMonacoInstance] = useState<Monaco | null>(null);

  const themeName = mode === 'dark' ? 'nuclei-dark' : 'nuclei-light';

  const handleMount: OnMount = (editor, monacoApi) => {
    editorRef.current = editor;
    monacoRef.current = monacoApi;
    setEditorInstance(editor);
    setMonacoInstance(monacoApi);

    editor.addAction({
      id: 'run-circuit',
      label: 'Run Circuit',
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Enter],
      run: () => {
        const execute = getExecute();
        if (execute) execute();
      },
    });

    editor.addAction({
      id: 'inline-edit',
      label: 'Inline Edit (Cmd+K)',
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyK],
      run: () => setShowInlineEdit(true),
    });

    registerGhostCompletions(monacoApi);
    editor.focus();
  };

  // Re-apply theme on mode change. Themes themselves are defined once in
  // beforeMount; this effect just switches between them.
  useEffect(() => {
    const monacoApi = monacoRef.current;
    if (!monacoApi) return;
    monacoApi.editor.setTheme(themeName);
  }, [themeName]);

  // Update Monaco error markers when errors change
  useEffect(() => {
    const monacoApi = monacoRef.current;
    const editor = editorRef.current;
    if (!monacoApi || !editor) return;

    const model = editor.getModel();
    if (!model) return;

    if (errors.length === 0) {
      monacoApi.editor.setModelMarkers(model, 'nuclei', []);
      return;
    }

    // Clamp line numbers to the valid range — kernel errors may reference
    // lines that no longer exist if the user kept typing after the error.
    const lineCount: number = model.getLineCount();
    const markers = errors
      .filter((err) => err.line >= 1 && err.line <= lineCount)
      .map((err) => ({
        severity: monacoApi.MarkerSeverity.Error,
        message: err.message,
        startLineNumber: err.line,
        startColumn: 1,
        endLineNumber: err.line,
        endColumn: model.getLineMaxColumn(err.line),
      }));
    monacoApi.editor.setModelMarkers(model, 'nuclei', markers);
  }, [errors]);

  const handleChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      setCode(value);
    }
  }, [setCode]);

  // Race guard for file drops: reading a File is async, but the component
  // may unmount between the drop and the read completing. Track the latest
  // drop token so a stale read can't overwrite fresh state.
  const dropTokenRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!(file.name.endsWith('.py') || file.name.endsWith('.qasm'))) return;

    dropTokenRef.current += 1;
    const token = dropTokenRef.current;

    file.text().then((content) => {
      if (!mountedRef.current) return;
      if (token !== dropTokenRef.current) return;
      setCode(content);
    }).catch(() => {
      // Drop-read errors are non-fatal — the user can retry.
    });
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
        beforeMount={registerNucleiThemes}
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
