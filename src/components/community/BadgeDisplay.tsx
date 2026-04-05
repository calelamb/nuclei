import { useState } from 'react';
import { Trophy } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { BADGES } from '../../data/community/badges';

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
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 8,
      }}
    >
      {BADGES.map((badge) => {
        const earned = earnedBadgeIds.includes(badge.id);
        const hovered = hoveredId === badge.id;

        return (
          <div
            key={badge.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: 8,
              borderRadius: 6,
              background: hovered ? colors.bg : 'transparent',
              position: 'relative',
              opacity: earned ? 1 : 0.4,
              transition: 'opacity 0.15s, background 0.15s',
              cursor: 'default',
            }}
            onMouseEnter={() => setHoveredId(badge.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <Trophy
              size={20}
              style={{
                color: earned ? colors.accent : colors.textDim,
                transition: 'color 0.15s',
              }}
            />
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                fontFamily: "'Geist Sans', sans-serif",
                color: earned ? colors.text : colors.textDim,
                textAlign: 'center',
                lineHeight: 1.2,
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
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  whiteSpace: 'nowrap',
                  zIndex: 10,
                  pointerEvents: 'none',
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    color: colors.textMuted,
                    fontFamily: "'Geist Sans', sans-serif",
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
