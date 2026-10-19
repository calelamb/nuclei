import { useCallback, useEffect, useMemo, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import type * as MonacoApi from 'monaco-editor';
import { sharedCodeFailure } from './codeFailure';
import { Braces } from 'lucide-react';
import { Badge } from '../ui';
import { useThemeStore } from '../../stores/themeStore';
import { registerNucleiThemes } from '../editor/monacoThemes';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import type { QuantumChallenge } from '../../types/challenge';

import { TYPOGRAPHY } from '../../styles/tokens';
const MARKER_OWNER = 'nuclei-challenge-run';

interface ProblemEditorProps {
  challenge: QuantumChallenge;
}

function buildSignature(challenge: QuantumChallenge) {
  const entrypoint = challenge.entrypoint_name ?? 'solve';
  const args = challenge.arguments ?? [];
  const signature = args.map((arg) => arg.name).join(', ');
  return challenge.contract_kind === 'returns_value'
    ? `${entrypoint}(${signature}) -> JSON value`
    : `${entrypoint}(${signature}) -> QuantumCircuit`;
}

export function ProblemEditor({ challenge }: ProblemEditorProps) {
  const colors = useThemeStore((s) => s.colors);
  const mode = useThemeStore((s) => s.mode);
  const activeFramework = useChallengeModeStore((s) => s.activeFramework);
  const updateDraftCode = useChallengeModeStore((s) => s.updateDraftCode);
  const progress = useChallengeModeStore((s) => s.progress);
  const testResults = useChallengeModeStore((s) => s.currentTestResults);
  const [handle, setHandle] = useState<{ editor: MonacoApi.editor.IStandaloneCodeEditor; monaco: typeof MonacoApi } | null>(null);
  const failureLine = useMemo(() => sharedCodeFailure(testResults)?.line ?? null, [testResults]);

  const savedCode = progress[challenge.id]?.currentCode[activeFramework];
  const editorValue = savedCode || challenge.starter_template || challenge.starterCode[activeFramework] || '';
  const isValueContract = challenge.contract_kind === 'returns_value';
  const frameworkLabel = (challenge.default_framework ?? 'qiskit').replace(/^./, (c) => c.toUpperCase());

  const clearMarker = useCallback(() => {
    const model = handle?.editor.getModel?.();
    if (handle && model) handle.monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
  }, [handle]);

  // Mark the line the last run failed on; editing the code drops the mark.
  useEffect(() => {
    const model = handle?.editor.getModel?.();
    if (!handle || !model) return;
    if (failureLine === null || failureLine > model.getLineCount()) { clearMarker(); return; }
    handle.monaco.editor.setModelMarkers(model, MARKER_OWNER, [{
      severity: handle.monaco.MarkerSeverity.Error,
      message: 'Your code stopped here, so no test case ran',
      startLineNumber: failureLine,
      endLineNumber: failureLine,
      startColumn: model.getLineFirstNonWhitespaceColumn(failureLine) || 1,
      endColumn: model.getLineMaxColumn(failureLine),
    }]);
  }, [handle, failureLine, clearMarker]);

  const handleMount: OnMount = useCallback((editor, monaco) => { setHandle({ editor, monaco }); }, []);

  const handleChange = useCallback((value: string | undefined) => {
    clearMarker();
    if (value !== undefined) {
      updateDraftCode(challenge.id, activeFramework, value);
    }
  }, [challenge.id, activeFramework, updateDraftCode, clearMarker]);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: colors.bg,
    }}>
      <div style={{
        padding: '10px 14px',
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bgPanel,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}>
        <div>
          <div style={{
            color: colors.text,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: TYPOGRAPHY.fontSans,
            marginBottom: 4,
          }}>
            Function contract
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: colors.accentText,
            fontSize: 12,
            fontFamily: TYPOGRAPHY.fontMono,
          }}>
            <Braces size={12} />
            <span>{buildSignature(challenge)}</span>
          </div>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          color: colors.textMuted,
          fontSize: 11,
          fontFamily: TYPOGRAPHY.fontSans,
        }}>
          <Badge tone="accent">{isValueContract ? 'Python value' : frameworkLabel}</Badge>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          theme={mode === 'dark' ? 'nuclei-dark' : 'nuclei-light'}
          beforeMount={registerNucleiThemes}
          language="python"
          value={editorValue}
          onChange={handleChange}
          onMount={handleMount}
          options={{
            fontSize: 13,
            fontFamily: TYPOGRAPHY.fontMono,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: 12 },
            lineNumbers: 'on',
            renderLineHighlight: 'gutter',
            tabSize: 4,
            automaticLayout: true,
            wordWrap: 'on',
          }}
        />
      </div>
    </div>
  );
}
