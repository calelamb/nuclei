import { useThemeStore } from '../../stores/themeStore';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { Button } from '../ui';
import '../dirac/dirac.css';
import './lessonBlocks.css';
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
        <text x="24" y="15" textAnchor="middle" style={{ fill: 'var(--color-surface-sunken)' }} fontSize="10" fontWeight="600">H</text>
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

  return <div className="concept__visual" aria-hidden="true">{icons[type]}</div>;
}

export function ConceptCard({ title, visual, explanation }: ConceptCardProps) {
  const ask = useDiracPanelStore((s) => s.ask);
  const askDirac = () => ask(`Can you explain "${title}" in more detail?`);

  return (
    <div className="concept">
      <div className="concept__body">
        <div className="concept__head">
          <VisualPlaceholder type={visual} />
          <div className="concept__title">{title}</div>
        </div>
        <div className="concept__text">{explanation}</div>
        <Button size="sm" className="concept__ask dirac-btn-dirac" onClick={askDirac}>Ask Dirac</Button>
      </div>
    </div>
  );
}
