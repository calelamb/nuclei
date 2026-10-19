import { useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { Braces } from 'lucide-react';
import { Badge } from '../ui';
import { useThemeStore } from '../../stores/themeStore';
import { registerNucleiThemes } from '../editor/monacoThemes';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import type { QuantumChallenge } from '../../types/challenge';

import { TYPOGRAPHY } from '../../styles/tokens';
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

  const savedCode = progress[challenge.id]?.currentCode[activeFramework];
  const editorValue = savedCode || challenge.starter_template || challenge.starterCode[activeFramework] || '';
  const isValueContract = challenge.contract_kind === 'returns_value';
  const frameworkLabel = (challenge.default_framework ?? 'qiskit').replace(/^./, (c) => c.toUpperCase());

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
