import { Atom } from 'lucide-react';
import type { ThemeColors } from '../stores/themeStore';

interface WhatsNewHeaderProps {
  currentVersion: string;
  accent: string;
  textDim: ThemeColors['textDim'];
  reduced: boolean;
}

/**
 * The "release moment" header band: a rotating-ring atom chip (the one
 * quantum motif) plus the uppercase eyebrow and monospace version pill.
 */
export function WhatsNewHeader({ currentVersion, accent, textDim, reduced }: WhatsNewHeaderProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
      <div style={{ position: 'relative', width: 40, height: 40, flexShrink: 0 }}>
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: -4,
            borderRadius: 12,
            border: `1px solid ${accent}35`,
            borderTopColor: accent,
            animation: reduced ? 'none' : 'nuclei-spin 8s linear infinite',
            willChange: 'transform',
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `linear-gradient(135deg, ${accent}33, ${accent}10)`,
            border: `1px solid ${accent}55`,
            color: accent,
          }}
        >
          <Atom size={20} strokeWidth={1.75} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: textDim,
          }}
        >
          What's new
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            alignSelf: 'flex-start',
            padding: '2px 9px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.02em',
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            color: accent,
            background: `${accent}1f`,
            border: `1px solid ${accent}55`,
          }}
        >
          {`v${currentVersion}`}
        </span>
      </div>
    </div>
  );
}
