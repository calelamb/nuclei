import { Badge } from '../ui';
import { Heart, Bookmark } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import type { GalleryCircuit } from '../../data/community/mockGallery';
import { activateOnKey } from '../../lib/a11y';

import { TYPOGRAPHY } from '../../styles/tokens';
interface CircuitCardProps {
  circuit: GalleryCircuit;
  isLiked: boolean;
  isBookmarked: boolean;
  onLike: () => void;
  onBookmark: () => void;
  onClick: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  tutorial: 'Tutorial',
  algorithm: 'Algorithm',
  art: 'Art',
  challenge: 'Challenge',
};

export function CircuitCard({ circuit, isLiked, isBookmarked, onLike, onBookmark, onClick }: CircuitCardProps) {
  const colors = useThemeStore((s) => s.colors);

  return (
    <div className="nuclei-hover-border"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={activateOnKey(onClick)}
      style={{
        background: colors.bgElevated,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 12,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'border-color 0.15s',
        position: 'relative',
      }}
    >
      {/* Category tag */}
      <span
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          fontSize: 11,
          fontWeight: 600,
          fontFamily: TYPOGRAPHY.fontSans,
          color: colors.textDim,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          background: colors.bg,
          padding: '2px 6px',
          borderRadius: 4,
        }}
      >
        {CATEGORY_LABELS[circuit.category] ?? circuit.category}
      </span>

      {/* Title */}
      <span
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: colors.text,
          fontFamily: TYPOGRAPHY.fontSans,
          paddingRight: 50,
          lineHeight: 1.3,
        }}
      >
        {circuit.title}
      </span>

      {/* Author + Framework */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            fontSize: 11,
            color: colors.textMuted,
            fontFamily: TYPOGRAPHY.fontSans,
          }}
        >
          {circuit.author.displayName}
        </span>
        <Badge style={{ textTransform: 'uppercase' }}>{circuit.framework}</Badge>
      </div>

      {/* Bottom row: like + bookmark */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLike();
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 4px',
            borderRadius: 4,
            color: isLiked ? colors.accentText : colors.textDim,
            fontSize: 11,
            fontFamily: TYPOGRAPHY.fontSans,
            transition: 'color 0.15s',
          }}
        >
          <Heart size={14} fill={isLiked ? colors.accent : 'none'} />
          {circuit.likes + (isLiked ? 1 : 0)}
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onBookmark();
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 4px',
            borderRadius: 4,
            color: isBookmarked ? colors.warning : colors.textDim,
            transition: 'color 0.15s',
          }}
        >
          <Bookmark size={14} fill={isBookmarked ? colors.warning : 'none'} />
        </button>
      </div>
    </div>
  );
}
