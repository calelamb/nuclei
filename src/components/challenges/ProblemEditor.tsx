import { useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { Braces } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import type { QuantumChallenge } from '../../types/challenge';

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
  const shadow = useThemeStore((s) => s.shadow);
  const activeFramework = useChallengeModeStore((s) => s.activeFramework);
  const updateDraftCode = useChallengeModeStore((s) => s.updateDraftCode);
  const progress = useChallengeModeStore((s) => s.progress);

  const savedCode = progress[challenge.id]?.currentCode[activeFramework];
  const editorValue = savedCode || challenge.starter_template || challenge.starterCode[activeFramework] || '';
  const isValueContract = challenge.contract_kind === 'returns_value';

  const handleChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      updateDraftCode(challenge.id, activeFramework, value);
    }
  }, [challenge.id, activeFramework, updateDraftCode]);

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
            fontFamily: "'Geist Sans', sans-serif",
            marginBottom: 4,
          }}>
            Function Contract
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: colors.accent,
            fontSize: 12,
            fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
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
          fontFamily: "'Geist Sans', sans-serif",
        }}>
          <span style={{
            padding: '3px 8px',
            borderRadius: 999,
            background: `${colors.accent}18`,
            color: colors.accent,
            boxShadow: shadow.sm,
          }}>
            {isValueContract ? 'PYTHON VALUE' : (challenge.default_framework?.toUpperCase() ?? 'QISKIT')}
          </span>
          <span>
            {isValueContract
              ? 'Return a JSON-serializable value. The harness injects test inputs.'
              : 'Implement the solver only. The harness injects test inputs.'}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <Editor
          theme="vs-dark"
          language="python"
          value={editorValue}
          onChange={handleChange}
          options={{
            fontSize: 13,
            fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
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
