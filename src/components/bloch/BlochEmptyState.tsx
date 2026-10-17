import { useThemeStore } from '../../stores/themeStore';
import './bloch.css';

export function BlochEmptyState() {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div className="bloch-empty">
      <svg width={72} height={72} viewBox="0 0 72 72" aria-hidden="true" style={{ opacity: 0.2 }}>
        <defs>
          <radialGradient id="empty-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={colors.accent} stopOpacity="0.25" />
            <stop offset="100%" stopColor={colors.accent} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={36} cy={36} r={32} fill="url(#empty-glow)" />
        <circle cx={36} cy={36} r={30} fill="none" stroke={colors.wire} strokeWidth={1} />
        <ellipse cx={36} cy={36} rx={30} ry={10} fill="none" stroke={colors.wire} strokeWidth={0.5} />
        <ellipse cx={36} cy={36} rx={10} ry={30} fill="none" stroke={colors.wire} strokeWidth={0.5} />
        <line x1={36} y1={4} x2={36} y2={68} stroke={colors.wire} strokeWidth={0.5} strokeDasharray="2,2" />
        <line x1={4} y1={36} x2={68} y2={36} stroke={colors.wire} strokeWidth={0.5} strokeDasharray="2,2" />
      </svg>
      <span className="bloch-empty__text">Run a simulation to visualize qubit states</span>
    </div>
  );
}
