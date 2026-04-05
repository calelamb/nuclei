import { useMemo } from 'react';
import { useThemeStore } from '../../stores/themeStore';

interface ResultsComparisonProps {
  simulatorResult: Record<string, number> | null;
  hardwareResult: Record<string, number> | null;
}

function normalizeToProbs(counts: Record<string, number>): Record<string, number> {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return counts;
  const result: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) {
    result[k] = v / total;
  }
  return result;
}

export function ResultsComparison({
  simulatorResult,
  hardwareResult,
}: ResultsComparisonProps) {
  const colors = useThemeStore((s) => s.colors);

  const { simProbs, hwProbs, allKeys } = useMemo(() => {
    const sp = simulatorResult ? normalizeToProbs(simulatorResult) : null;
    const hp = hardwareResult ? normalizeToProbs(hardwareResult) : null;
    const keys = new Set<string>();
    if (sp) Object.keys(sp).forEach((k) => keys.add(k));
    if (hp) Object.keys(hp).forEach((k) => keys.add(k));
    return {
      simProbs: sp,
      hwProbs: hp,
      allKeys: Array.from(keys).sort(),
    };
  }, [simulatorResult, hardwareResult]);

  const font: React.CSSProperties = {
    fontFamily: "'Geist Sans', sans-serif",
  };

  return (
    <div>
      {/* Column headers */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div style={{ flex: 1, fontSize: 10, fontWeight: 600, color: colors.accent, ...font }}>
          Simulator
        </div>
        <div style={{ width: 44 }} />
        <div
          style={{
            flex: 1,
            fontSize: 10,
            fontWeight: 600,
            color: colors.accentLight,
            textAlign: 'right',
            ...font,
          }}
        >
          Hardware
        </div>
      </div>

      {allKeys.length === 0 && !simulatorResult && !hardwareResult && (
        <div
          style={{
            fontSize: 11,
            color: colors.textDim,
            textAlign: 'center',
            padding: '12px 0',
            ...font,
          }}
        >
          Run a simulation and hardware job to compare
        </div>
      )}

      {allKeys.map((key) => {
        const simVal = simProbs?.[key] ?? 0;
        const hwVal = hwProbs?.[key] ?? 0;
        const simPct = (simVal * 100).toFixed(1);
        const hwPct = (hwVal * 100).toFixed(1);

        return (
          <div
            key={key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginBottom: 4,
            }}
          >
            {/* Simulator bar (right-aligned) */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
              <span style={{ fontSize: 9, color: colors.textDim, ...font }}>{simPct}%</span>
              <div
                style={{
                  height: 10,
                  width: `${Math.max(simVal * 100, 1)}%`,
                  minWidth: simVal > 0 ? 2 : 0,
                  background: colors.accent,
                  borderRadius: 2,
                }}
              />
            </div>

            {/* Bitstring label */}
            <div
              style={{
                width: 44,
                textAlign: 'center',
                fontSize: 9,
                color: colors.textMuted,
                fontFamily: "'JetBrains Mono', monospace",
                flexShrink: 0,
              }}
            >
              |{key}⟩
            </div>

            {/* Hardware bar (left-aligned) */}
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
              <div
                style={{
                  height: 10,
                  width: `${Math.max(hwVal * 100, 1)}%`,
                  minWidth: hwVal > 0 ? 2 : 0,
                  background: colors.accentLight,
                  borderRadius: 2,
                }}
              />
              <span style={{ fontSize: 9, color: colors.textDim, ...font }}>{hwPct}%</span>
            </div>
          </div>
        );
      })}

      {/* Placeholder when only one side has data */}
      {simulatorResult && !hardwareResult && allKeys.length > 0 && (
        <div style={{ fontSize: 10, color: colors.textDim, textAlign: 'center', marginTop: 8, ...font }}>
          Run on hardware to compare
        </div>
      )}
      {!simulatorResult && hardwareResult && allKeys.length > 0 && (
        <div style={{ fontSize: 10, color: colors.textDim, textAlign: 'center', marginTop: 8, ...font }}>
          Run simulator to compare
        </div>
      )}
    </div>
  );
}
