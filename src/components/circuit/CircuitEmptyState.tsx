import { useThemeStore } from '../../stores/themeStore';
import { TYPOGRAPHY } from '../../styles/tokens';

/**
 * Shown in the circuit panel until the kernel has parsed a circuit: a faint
 * ghost of what is coming (two wires, an H, a CNOT) and one line of guidance.
 * A parse error replaces the ghost with the message so it is never hidden.
 */
export function CircuitEmptyState({ error }: { error: string | null }) {
  const colors = useThemeStore((s) => s.colors);

  if (error) {
    return (
      <div role="alert" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <span style={{ color: colors.error, fontSize: 13, fontFamily: TYPOGRAPHY.fontSans, textAlign: 'center' }}>{error}</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      style={{ height: '100%', minHeight: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10, padding: 12 }}
    >
      <svg width={168} height={64} viewBox="0 0 168 64" aria-hidden="true">
        <line x1={28} y1={16} x2={156} y2={16} stroke={colors.wire} strokeWidth={1.25} />
        <line x1={28} y1={48} x2={156} y2={48} stroke={colors.wire} strokeWidth={1.25} />
        <text x={20} y={16} textAnchor="end" dominantBaseline="central" fill={colors.textDim} fontSize={11} fontFamily={TYPOGRAPHY.fontMono}>q0</text>
        <text x={20} y={48} textAnchor="end" dominantBaseline="central" fill={colors.textDim} fontSize={11} fontFamily={TYPOGRAPHY.fontMono}>q1</text>
        <rect x={46} y={3} width={26} height={26} rx={6} fill={colors.bg} stroke={colors.accent} strokeWidth={1.25} strokeDasharray="3 3" />
        <text x={59} y={16} textAnchor="middle" dominantBaseline="central" fill={colors.accent} fontSize={12} fontWeight={600} fontFamily={TYPOGRAPHY.fontMono}>H</text>
        <line x1={106} y1={16} x2={106} y2={48} stroke={colors.textDim} strokeWidth={1.25} strokeDasharray="3 3" />
        <circle cx={106} cy={16} r={4} fill={colors.textDim} />
        <circle cx={106} cy={48} r={9} fill={colors.bg} stroke={colors.textDim} strokeWidth={1.25} strokeDasharray="3 3" />
      </svg>
      <span style={{ color: colors.textMuted, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans, textAlign: 'center', lineHeight: 1.5 }}>
        Your circuit appears here as you write code.
      </span>
    </div>
  );
}
