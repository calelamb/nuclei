import { useThemeStore } from '../../stores/themeStore';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { useDiracStore } from '../../stores/diracStore';

interface ConceptCardProps {
  title: string;
  visual: 'bloch' | 'circuit' | 'histogram' | 'custom-svg';
  explanation: string;
}

function VisualPlaceholder({ type }: { type: ConceptCardProps['visual'] }) {
  const colors = useThemeStore((s) => s.colors);

  const icons: Record<string, React.ReactNode> = {
    bloch: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="20" stroke={colors.accent} strokeWidth="1.5" opacity="0.4" />
        <ellipse cx="24" cy="24" rx="20" ry="8" stroke={colors.accent} strokeWidth="1" opacity="0.3" />
        <line x1="24" y1="4" x2="24" y2="44" stroke={colors.accent} strokeWidth="1" opacity="0.3" />
        <circle cx="24" cy="12" r="3" fill={colors.accent} opacity="0.8">
          <animate attributeName="cy" values="12;36;12" dur="3s" repeatCount="indefinite" />
        </circle>
      </svg>
    ),
    circuit: (
      <svg width="80" height="40" viewBox="0 0 80 40" fill="none">
        <line x1="0" y1="12" x2="80" y2="12" stroke={colors.wire} strokeWidth="1.5" />
        <line x1="0" y1="28" x2="80" y2="28" stroke={colors.wire} strokeWidth="1.5" />
        <rect x="16" y="4" width="16" height="16" rx="3" fill={colors.accent} opacity="0.8">
          <animate attributeName="opacity" values="0;0.8" dur="0.5s" fill="freeze" />
        </rect>
        <text x="24" y="15" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="600">H</text>
        <circle cx="48" cy="12" r="3" fill={colors.accent} />
        <line x1="48" y1="15" x2="48" y2="28" stroke={colors.accent} strokeWidth="1.5" />
        <circle cx="48" cy="28" r="6" stroke={colors.accent} strokeWidth="1.5" fill="none" />
        <line x1="42" y1="28" x2="54" y2="28" stroke={colors.accent} strokeWidth="1.5" />
      </svg>
    ),
    histogram: (
      <svg width="60" height="40" viewBox="0 0 60 40" fill="none">
        {[
          { x: 4, h: 30 }, { x: 18, h: 15 }, { x: 32, h: 28 }, { x: 46, h: 8 },
        ].map((bar, i) => (
          <rect
            key={i}
            x={bar.x}
            y={40 - bar.h}
            width="10"
            height={bar.h}
            rx="2"
            fill={colors.accent}
            opacity="0.7"
          >
            <animate attributeName="height" from="0" to={String(bar.h)} dur="0.6s" fill="freeze" begin={`${i * 0.1}s`} />
            <animate attributeName="y" from="40" to={String(40 - bar.h)} dur="0.6s" fill="freeze" begin={`${i * 0.1}s`} />
          </rect>
        ))}
      </svg>
    ),
    'custom-svg': (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
        <path d="M4 36 Q12 4 24 24 Q36 44 44 12" stroke={colors.accent} strokeWidth="2" fill="none" opacity="0.6">
          <animate attributeName="opacity" values="0.3;0.8;0.3" dur="2s" repeatCount="indefinite" />
        </path>
      </svg>
    ),
  };

  return (
    <div style={{
      height: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: `linear-gradient(135deg, ${colors.bgPanel}, ${colors.bgElevated})`,
      borderRadius: '12px 12px 0 0',
    }}>
      {icons[type]}
    </div>
  );
}

export function ConceptCard({ title, visual, explanation }: ConceptCardProps) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const openDirac = useDiracPanelStore((s) => s.open);
  const focusDirac = useDiracPanelStore((s) => s.focusInput);
  const addMessage = useDiracStore((s) => s.addMessage);

  const askDirac = () => {
    openDirac();
    addMessage({ role: 'user', content: `Can you explain "${title}" in more detail?` });
    setTimeout(focusDirac, 100);
  };

  return (
    <div style={{
      maxWidth: 480,
      margin: '16px auto',
      borderRadius: 12,
      overflow: 'hidden',
      background: colors.bgElevated,
      border: `1px solid ${colors.border}`,
      boxShadow: shadow.md,
    }}>
      <VisualPlaceholder type={visual} />
      <div style={{ padding: '16px 20px' }}>
        <div style={{
          color: colors.accent,
          fontSize: 16,
          fontWeight: 600,
          marginBottom: 8,
          fontFamily: "'Geist Sans', sans-serif",
        }}>
          {title}
        </div>
        <div style={{
          color: colors.textMuted,
          fontSize: 14,
          lineHeight: 1.6,
          fontFamily: "'Geist Sans', sans-serif",
        }}>
          {explanation}
        </div>
        <button
          onClick={askDirac}
          style={{
            marginTop: 12,
            padding: '6px 14px',
            background: `${colors.dirac}18`,
            border: `1px solid ${colors.dirac}40`,
            borderRadius: 6,
            color: colors.dirac,
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "'Geist Sans', sans-serif",
            cursor: 'pointer',
            transition: 'all 150ms ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = `${colors.dirac}28`;
            e.currentTarget.style.borderColor = colors.dirac;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = `${colors.dirac}18`;
            e.currentTarget.style.borderColor = `${colors.dirac}40`;
          }}
        >
          Ask Dirac
        </button>
      </div>
    </div>
  );
}
