import { useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import { useEditorStore } from '../../stores/editorStore';
import { getExecute } from '../../App';

export function QuantumEditor() {
  const { code, setCode } = useEditorStore();
  const editorRef = useRef<any>(null);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    editor.addAction({
      id: 'run-circuit',
      label: 'Run Circuit',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => {
        const execute = getExecute();
        if (execute) execute();
      },
    });

    editor.focus();
  };

  const handleChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      setCode(value);
    }
  }, [setCode]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Editor
        defaultLanguage="python"
        theme="nuclei-dark"
        value={code}
        onChange={handleChange}
        onMount={handleMount}
        options={{
          fontSize: 14,
          fontFamily: "'Fira Code', monospace",
          fontLigatures: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          padding: { top: 16 },
          lineNumbers: 'on',
          renderWhitespace: 'none',
          bracketPairColorization: { enabled: true },
          automaticLayout: true,
          tabSize: 4,
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
        }}
      />
    </div>
  );
}
