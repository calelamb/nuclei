import { useMemo } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import {
  useChallengeModeStore,
  type InspectionView,
} from '../../stores/challengeModeStore';

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);

  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 10px',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? `2px solid ${colors.accent}` : '2px solid transparent',
        color: active ? colors.text : colors.textMuted,
        fontSize: 11,
        fontWeight: active ? 600 : 500,
        fontFamily: "'Geist Sans', sans-serif",
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

export function ChallengeInspector() {
  const colors = useThemeStore((s) => s.colors);
  const inspection = useChallengeModeStore((s) => s.inspection);
  const inspectionView = useChallengeModeStore((s) => s.inspectionView);
  const setInspectionView = useChallengeModeStore((s) => s.setInspectionView);

  const histogramData = useMemo(() => {
    const probabilities = inspection?.result?.probabilities ?? {};
    return Object.entries(probabilities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16);
  }, [inspection]);

  if (!inspection) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: colors.textDim,
        fontSize: 12,
        fontFamily: "'Geist Sans', sans-serif",
      }}>
        Run “Inspect Quantum Output” to inspect a visible case.
      </div>
    );
  }

  const failure = inspection.failure;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '0 12px',
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bgPanel,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {(['circuit', 'histogram', 'bloch', 'output'] as InspectionView[]).map((view) => (
            <TabButton
              key={view}
              active={inspectionView === view}
              label={view === 'bloch' ? 'Bloch' : view[0].toUpperCase() + view.slice(1)}
              onClick={() => setInspectionView(view)}
            />
          ))}
        </div>
        <div style={{
          color: colors.textMuted,
          fontSize: 11,
          fontFamily: "'Geist Sans', sans-serif",
        }}>
          Inspecting {inspection.label}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {failure && (
          <div style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: `1px solid ${colors.error}33`,
            background: `${colors.error}12`,
            color: colors.text,
            fontSize: 12,
            fontFamily: "'Geist Sans', sans-serif",
            marginBottom: 14,
            lineHeight: 1.5,
          }}>
            {failure.message}
          </div>
        )}

        {!failure && inspectionView === 'circuit' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{
              color: colors.textMuted,
              fontSize: 12,
              fontFamily: "'Geist Sans', sans-serif",
            }}>
              {inspection.snapshot
                ? `${inspection.snapshot.qubit_count} qubits • depth ${inspection.snapshot.depth} • ${inspection.snapshot.gates.length} gates`
                : 'No circuit snapshot returned for this inspection.'}
            </div>
            {inspection.snapshot?.gates.map((gate, index) => (
              <div key={`${gate.type}-${index}`} style={{
                display: 'grid',
                gridTemplateColumns: '90px 1fr 1fr 70px',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 8,
                border: `1px solid ${colors.border}`,
                background: colors.bgPanel,
                color: colors.text,
                fontSize: 12,
                fontFamily: "'Geist Sans', sans-serif",
              }}>
                <strong style={{ color: colors.accent }}>{gate.type}</strong>
                <span>Targets: {gate.targets.join(', ') || '—'}</span>
                <span>Controls: {gate.controls.join(', ') || '—'}</span>
                <span>Layer {gate.layer}</span>
              </div>
            ))}
          </div>
        )}

        {!failure && inspectionView === 'histogram' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {histogramData.map(([state, probability]) => (
              <div key={state}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: colors.textMuted,
                  fontSize: 12,
                  fontFamily: "'Geist Sans', sans-serif",
                  marginBottom: 4,
                }}>
                  <span>|{state}⟩</span>
                  <span>{(probability * 100).toFixed(1)}%</span>
                </div>
                <div style={{
                  height: 8,
                  borderRadius: 999,
                  background: colors.border,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${Math.max(2, probability * 100)}%`,
                    height: '100%',
                    borderRadius: 999,
                    background: colors.accent,
                  }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!failure && inspectionView === 'bloch' && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}>
            {(inspection.result?.bloch_coords ?? []).map((coord, index) => (
              <div key={`bloch-${index}`} style={{
                padding: 12,
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.bgPanel,
              }}>
                <div style={{
                  color: colors.text,
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "'Geist Sans', sans-serif",
                  marginBottom: 10,
                }}>
                  Qubit {index}
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr',
                  gap: 6,
                  color: colors.textMuted,
                  fontSize: 12,
                  fontFamily: "'Geist Mono', monospace",
                }}>
                  <span>x</span><span>{coord.x.toFixed(3)}</span>
                  <span>y</span><span>{coord.y.toFixed(3)}</span>
                  <span>z</span><span>{coord.z.toFixed(3)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {inspectionView === 'output' && (
          <div style={{
            padding: '12px 14px',
            borderRadius: 10,
            border: `1px solid ${colors.border}`,
            background: colors.bgPanel,
            color: colors.text,
            fontSize: 12,
            fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
            whiteSpace: 'pre-wrap',
            lineHeight: 1.6,
          }}>
            {inspection.stdout.trim() || JSON.stringify({
              probabilities: inspection.result?.probabilities ?? {},
              measurements: inspection.result?.measurements ?? {},
            }, null, 2)}
          </div>
        )}
      </div>
    </div>
  );
}
