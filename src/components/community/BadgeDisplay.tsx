import { useState } from 'react';
import { Lock, Trophy } from 'lucide-react';
import { ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { useThemeStore } from '../../stores/themeStore';
import { BADGES } from '../../data/community/badges';

import { TYPOGRAPHY } from '../../styles/tokens';
interface BadgeDisplayProps {
  earnedBadgeIds: string[];
}

export function BadgeDisplay({ earnedBadgeIds }: BadgeDisplayProps) {
  const colors = useThemeStore((s) => s.colors);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 8,
      }}
    >
      {BADGES.map((badge) => {
        const earned = earnedBadgeIds.includes(badge.id);
        const hovered = hoveredId === badge.id;

        return (
          <div
            key={badge.id}
            tabIndex={0}
            role="group"
            aria-label={`${badge.name}${earned ? '' : ' (locked)'}: ${badge.description}`}
            onFocus={() => setHoveredId(badge.id)}
            onBlur={() => setHoveredId(null)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: 8,
              borderRadius: 6,
              background: hovered ? colors.bg : 'transparent',
              position: 'relative',
              transition: 'background 0.15s',
              cursor: 'default',
            }}
            onMouseEnter={() => setHoveredId(badge.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {earned
              ? <Trophy size={ICON_SIZE.lg} strokeWidth={ICON_STROKE} style={{ color: colors.accentText }} aria-hidden="true" />
              : <Lock size={ICON_SIZE.lg} strokeWidth={ICON_STROKE} style={{ color: colors.textDim }} aria-hidden="true" />}
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                fontFamily: TYPOGRAPHY.fontSans,
                color: earned ? colors.text : colors.textMuted,
                textAlign: 'center',
                lineHeight: 1.2,
                overflowWrap: 'anywhere',
              }}
            >
              {badge.name}
            </span>

            {/* Tooltip on hover */}
            {hovered && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  marginBottom: 4,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: colors.bgElevated,
                  border: `1px solid ${colors.borderStrong}`,
                  boxShadow: 'var(--shadow-md)',
                  whiteSpace: 'nowrap',
                  zIndex: 10,
                  pointerEvents: 'none',
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    color: colors.textMuted,
                    fontFamily: TYPOGRAPHY.fontSans,
                  }}
                >
                  {badge.description}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
