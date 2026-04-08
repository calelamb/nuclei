import { useCallback } from 'react';
import Editor from '@monaco-editor/react';
import { useThemeStore } from '../../stores/themeStore';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import type { QuantumChallenge } from '../../types/challenge';
import type { Framework } from '../../types/quantum';

interface ProblemEditorProps {
  challenge: QuantumChallenge;
}

const FRAMEWORKS: Array<{ label: string; value: Framework }> = [
  { label: 'Qiskit', value: 'qiskit' },
  { label: 'Cirq', value: 'cirq' },
  { label: 'CUDA-Q', value: 'cuda-q' },
];

export function ProblemEditor({ challenge }: ProblemEditorProps) {
  const colors = useThemeStore((s) => s.colors);
  const activeFramework = useChallengeModeStore((s) => s.activeFramework);
  const setActiveFramework = useChallengeModeStore((s) => s.setActiveFramework);
  const updateDraftCode = useChallengeModeStore((s) => s.updateDraftCode);
  const progress = useChallengeModeStore((s) => s.progress);

  const savedCode = progress[challenge.id]?.currentCode[activeFramework];
  const starterCode = challenge.starterCode[activeFramework] ?? '';
  const editorValue = savedCode || starterCode;

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
      {/* Framework tab bar */}
      <div style={{
        height: 34,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 8px',
        gap: 2,
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bgPanel,
      }}>
        {FRAMEWORKS.map((fw) => {
          const isActive = activeFramework === fw.value;
          return (
            <button
              key={fw.value}
              onClick={() => setActiveFramework(fw.value)}
              style={{
                padding: '4px 14px',
                borderRadius: 4,
                border: 'none',
                background: isActive ? colors.bgElevated : 'transparent',
                color: isActive ? colors.accent : colors.textMuted,
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                fontFamily: "'Geist Sans', sans-serif",
                cursor: 'pointer',
                transition: 'all 150ms ease',
                borderBottom: isActive ? `2px solid ${colors.accent}` : '2px solid transparent',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = colors.text;
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = colors.textMuted;
              }}
            >
              {fw.label}
            </button>
          );
        })}
      </div>

      {/* Monaco editor */}
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
