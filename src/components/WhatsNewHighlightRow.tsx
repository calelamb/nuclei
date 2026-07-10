import { WHATS_NEW_ICONS } from '../data/whatsNewIcons';
import type { WhatsNewHighlight } from '../data/whatsNew';
import { staggerStyle } from '../lib/animations';

interface WhatsNewHighlightRowProps {
  highlight: WhatsNewHighlight;
  index: number;
  accent: string;
  dirac: string;
  text: string;
  textMuted: string;
}

/** One release-highlight row: a category-tinted icon chip, a bold label, and a description. */
export function WhatsNewHighlightRow({
  highlight,
  index,
  accent,
  dirac,
  text,
  textMuted,
}: WhatsNewHighlightRowProps) {
  const Icon = WHATS_NEW_ICONS[highlight.icon];
  const color = highlight.icon === 'dirac' ? dirac : accent;

  return (
    <li style={{ display: 'flex', alignItems: 'flex-start', gap: 12, ...staggerStyle(index) }}>
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 30,
          height: 30,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `${color}14`,
          color,
        }}
      >
        <Icon size={15} strokeWidth={2} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 1 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: text, lineHeight: 1.35 }}>
          {highlight.title}
        </span>
        <span style={{ fontSize: 12.5, lineHeight: 1.5, color: textMuted }}>{highlight.text}</span>
      </span>
    </li>
  );
}
