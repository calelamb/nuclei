import { useEffect } from 'react';
import { useCircuitStore } from '../../stores/circuitStore';
import { useThemeStore } from '../../stores/themeStore';
import { getGateData } from '../../data/gates';
import { TYPOGRAPHY } from '../../styles/tokens';
import { Dialog } from '../ui';

const sectionLabel = { fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, marginBottom: 4 } as const;

/** Explains one gate (matrix, Bloch effect, per-framework syntax) in a focus-trapping dialog. */
export function GateExplorerPopup({ gateIndex, onClose }: { gateIndex: number; onClose: () => void }) {
  const snapshot = useCircuitStore((s) => s.snapshot);
  const colors = useThemeStore((s) => s.colors);
  const gate = snapshot?.gates[gateIndex];
  const data = gate ? getGateData(gate.type) : undefined;

  // A gate with no catalogue entry has nothing to explain: close instead of showing an empty dialog.
  useEffect(() => {
    if (!data) onClose();
  }, [data, onClose]);

  if (!data) return null;

  return (
    <Dialog
      title={(
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ color: colors.accentText, fontWeight: 700, fontFamily: TYPOGRAPHY.fontMono }}>{data.symbol}</span>
          {data.name}
        </span>
      )}
      width={420}
      onClose={onClose}
    >
      <div style={{ color: colors.text, fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>{data.description}</div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ ...sectionLabel, color: colors.textMuted }}>MATRIX</div>
        <code style={{ color: colors.accentText, fontSize: 12, fontFamily: TYPOGRAPHY.fontMono, background: colors.bgPanel, padding: '4px 8px', borderRadius: 4, display: 'block' }}>
          {data.matrix}
        </code>
      </div>

      {data.blochRotation && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ ...sectionLabel, color: colors.textMuted }}>BLOCH SPHERE EFFECT</div>
          <div style={{ color: colors.text, fontSize: 12 }}>
            Rotation around <strong style={{ color: colors.accentText }}>{data.blochRotation.axis}</strong> axis by <strong style={{ color: colors.accentText }}>{data.blochRotation.angle}</strong>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <div style={{ ...sectionLabel, color: colors.textMuted }}>FRAMEWORK SYNTAX</div>
        {Object.entries(data.frameworkSyntax).map(([fw, syntax]) => (
          <div key={fw} style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
            <span style={{ color: colors.textMuted, fontSize: 11, width: 60 }}>{fw}</span>
            <code style={{ color: colors.string, fontSize: 12, fontFamily: TYPOGRAPHY.fontMono }}>{syntax}</code>
          </div>
        ))}
      </div>

      {data.relatedGates.length > 0 && (
        <div>
          <div style={{ ...sectionLabel, color: colors.textMuted }}>RELATED GATES</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {data.relatedGates.map((g) => (
              <span key={g} style={{ color: colors.accentText, fontSize: 12, fontFamily: TYPOGRAPHY.fontMono, background: colors.bgPanel, padding: '2px 6px', borderRadius: 4 }}>{g}</span>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}
