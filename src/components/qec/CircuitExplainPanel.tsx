import { useCallback } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useEditorStore } from '../../stores/editorStore';
import { useQecExplainStore } from '../../stores/qecExplainStore';
import { useEditorRevealStore } from '../../stores/editorRevealStore';
import { requestQecExplain } from '../../lib/qecExplainSender';
import { isStimCircuitText } from '../../lib/stimText';
import { NondeterministicSection, MinWeightSection } from './ExplainSections';
import { FONT } from './explainFormat';

const STATIC_NOTE =
  'Static analysis of the circuit text as written. It says nothing about sampled data, and Nuclei never edits your circuit.';

/**
 * Explains why a QEC circuit fails: Stim's non-determinism error as a sentence
 * + Stim's own detector-slice diagram, and a minimum-weight undetected logical
 * error with every fault's tick / qubits / gate / source line. Every location
 * links to the editor line it came from. Results are bound to the exact text
 * analysed; once the editor changes, line links are disabled (not guessed).
 */
export function CircuitExplainPanel() {
  const colors = useThemeStore((s) => s.colors);
  const code = useEditorStore((s) => s.code);
  const filePath = useEditorStore((s) => s.filePath);
  const { result, forText, pending, error } = useQecExplainStore();
  const revealLine = useEditorRevealStore((s) => s.revealLine);

  const analysable = isStimCircuitText(code, filePath);
  const stale = result !== null && forText !== code;

  const run = useCallback(() => {
    requestQecExplain(code, 'both');
  }, [code]);

  return (
    <section
      aria-label="Circuit explain"
      style={{
        borderTop: `1px solid ${colors.border}`, background: colors.bg, fontFamily: FONT,
        maxHeight: '45%', overflowY: 'auto', flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: colors.text }}>Why does this circuit fail?</span>
        <button
          type="button"
          onClick={run}
          disabled={!analysable || pending}
          style={{
            marginLeft: 'auto', background: colors.accent, color: colors.bg, border: 'none', borderRadius: 4,
            fontSize: 11, padding: '4px 9px', cursor: !analysable || pending ? 'default' : 'pointer',
            opacity: !analysable || pending ? 0.6 : 1, fontFamily: FONT,
          }}
        >
          {pending ? 'Analysing…' : result ? 'Re-run' : 'Explain circuit'}
        </button>
      </div>
      <div style={{ padding: '0 12px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!analysable && (
          <div style={{ fontSize: 11, color: colors.textDim }}>
            Open a .stim circuit to analyse it. Python-built circuits have no single circuit text to map lines onto.
          </div>
        )}
        {error && (
          <div role="alert" style={{ fontSize: 12, color: colors.error, lineHeight: 1.5 }}>
            {error}
          </div>
        )}
        {stale && (
          <div role="status" style={{ fontSize: 11, color: colors.warning }}>
            The circuit changed since this analysis. Line links are disabled; re-run to refresh.
          </div>
        )}
        {result?.nondeterministic && (
          <NondeterministicSection data={result.nondeterministic} stale={stale} onJump={revealLine} />
        )}
        {result?.min_weight && <MinWeightSection data={result.min_weight} stale={stale} onJump={revealLine} />}
        <div style={{ fontSize: 11, color: colors.textDim }}>{STATIC_NOTE}</div>
      </div>
    </section>
  );
}
