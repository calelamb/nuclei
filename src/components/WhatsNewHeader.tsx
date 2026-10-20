import { NucleiMark } from './brand/NucleiMark';
import type { ThemeColors } from '../stores/themeStore';

import { TYPOGRAPHY } from '../styles/tokens';
interface WhatsNewHeaderProps {
  /** The pill text: a released version (v0.14.0) or an upcoming one (Coming in 0.14). */
  versionLabel: string;
  accent: string;
  textDim: ThemeColors['textDim'];
  reduced: boolean;
}

/**
 * The "release moment" header band: a rotating-ring chip holding the Nuclei mark plus the uppercase eyebrow and monospace version pill.
 */
export function WhatsNewHeader({ versionLabel, accent, textDim, reduced }: WhatsNewHeaderProps) {
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
            // One settled turn on open; a ring that spins forever reads as a loading state.
            animation: reduced ? 'none' : 'nuclei-spin 1.4s cubic-bezier(0.22, 1, 0.36, 1) 1',
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
          <NucleiMark size={22} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span
          style={{
            fontSize: 11,
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
            fontFamily: TYPOGRAPHY.fontMono,
            color: accent,
            background: `${accent}1f`,
            border: `1px solid ${accent}55`,
          }}
        >
          {versionLabel}
        </span>
      </div>
    </div>
  );
}
