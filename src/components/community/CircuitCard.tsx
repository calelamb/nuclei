import { Heart, Bookmark } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import type { GalleryCircuit } from '../../data/community/mockGallery';

interface CircuitCardProps {
  circuit: GalleryCircuit;
  isLiked: boolean;
  isBookmarked: boolean;
  onLike: () => void;
  onBookmark: () => void;
  onClick: () => void;
}

const FRAMEWORK_COLORS: Record<string, string> = {
  qiskit: '#6929C4',
  cirq: '#F4B400',
  'cuda-q': '#76B900',
};

const CATEGORY_LABELS: Record<string, string> = {
  tutorial: 'Tutorial',
  algorithm: 'Algorithm',
  art: 'Art',
  challenge: 'Challenge',
};

export function CircuitCard({ circuit, isLiked, isBookmarked, onLike, onBookmark, onClick }: CircuitCardProps) {
  const colors = useThemeStore((s) => s.colors);

  return (
    <div
      onClick={onClick}
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
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = colors.borderStrong;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = colors.border;
      }}
    >
      {/* Category tag */}
      <span
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          fontSize: 9,
          fontWeight: 600,
          fontFamily: "'Geist Sans', sans-serif",
          color: colors.textDim,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
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
          fontFamily: "'Geist Sans', sans-serif",
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
            fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          {circuit.author.displayName}
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            fontFamily: "'Geist Sans', sans-serif",
            color: '#fff',
            background: FRAMEWORK_COLORS[circuit.framework] ?? colors.accent,
            padding: '1px 5px',
            borderRadius: 3,
            textTransform: 'uppercase',
          }}
        >
          {circuit.framework}
        </span>
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
            color: isLiked ? colors.accent : colors.textDim,
            fontSize: 11,
            fontFamily: "'Geist Sans', sans-serif",
            transition: 'color 0.15s',
          }}
        >
          <Heart size={13} fill={isLiked ? colors.accent : 'none'} />
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
          <Bookmark size={13} fill={isBookmarked ? colors.warning : 'none'} />
        </button>
      </div>
    </div>
  );
}
