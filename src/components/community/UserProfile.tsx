import { useState } from 'react';
import { Pencil, Check, Flame, Upload } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useProfileStore } from '../../stores/profileStore';
import { useEditorStore } from '../../stores/editorStore';
import { BadgeDisplay } from './BadgeDisplay';

export function UserProfile() {
  const colors = useThemeStore((s) => s.colors);
  const displayName = useProfileStore((s) => s.displayName);
  const circuitsShared = useProfileStore((s) => s.circuitsShared);
  const exercisesCompleted = useProfileStore((s) => s.exercisesCompleted);
  const currentStreak = useProfileStore((s) => s.currentStreak);
  const badgesEarned = useProfileStore((s) => s.badgesEarned);
  const joinedAt = useProfileStore((s) => s.joinedAt);
  const setDisplayName = useProfileStore((s) => s.setDisplayName);
  const incrementCircuitsShared = useProfileStore((s) => s.incrementCircuitsShared);
  const code = useEditorStore((s) => s.code);

  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(displayName);

  const handleSaveName = () => {
    const trimmed = nameInput.trim();
    if (trimmed) {
      setDisplayName(trimmed);
    } else {
      setNameInput(displayName);
    }
    setEditing(false);
  };

  const joinDate = new Date(joinedAt).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });

  const handleShare = () => {
    // In a real app this would push to the gallery service
    if (code.trim()) {
      incrementCircuitsShared();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* Display name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {editing ? (
          <>
            <input
              autoFocus
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveName();
                if (e.key === 'Escape') {
                  setNameInput(displayName);
                  setEditing(false);
                }
              }}
              style={{
                flex: 1,
                padding: '4px 8px',
                borderRadius: 4,
                border: `1px solid ${colors.accent}`,
                background: colors.bg,
                color: colors.text,
                fontSize: 14,
                fontWeight: 700,
                fontFamily: "'Geist Sans', sans-serif",
                outline: 'none',
              }}
            />
            <button
              onClick={handleSaveName}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: colors.success,
                padding: 4,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Check size={14} />
            </button>
          </>
        ) : (
          <>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: colors.text,
                fontFamily: "'Geist Sans', sans-serif",
                flex: 1,
              }}
            >
              {displayName}
            </span>
            <button
              onClick={() => {
                setNameInput(displayName);
                setEditing(true);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: colors.textDim,
                padding: 4,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Pencil size={12} />
            </button>
          </>
        )}
      </div>

      <span
        style={{
          fontSize: 10,
          color: colors.textDim,
          fontFamily: "'Geist Sans', sans-serif",
          marginTop: -10,
        }}
      >
        Joined {joinDate}
      </span>

      {/* Stats row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
        }}
      >
        {[
          { label: 'Shared', value: circuitsShared },
          { label: 'Exercises', value: exercisesCompleted },
          { label: 'Streak', value: currentStreak, hasFlame: currentStreak > 0 },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              padding: 8,
              borderRadius: 6,
              background: colors.bg,
              border: `1px solid ${colors.border}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: colors.text,
                  fontFamily: "'Geist Sans', sans-serif",
                }}
              >
                {stat.value}
              </span>
              {stat.hasFlame && <Flame size={14} style={{ color: colors.warning }} />}
            </div>
            <span
              style={{
                fontSize: 9,
                color: colors.textDim,
                fontFamily: "'Geist Sans', sans-serif",
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                fontWeight: 600,
              }}
            >
              {stat.label}
            </span>
          </div>
        ))}
      </div>

      {/* Badges */}
      <div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: colors.textMuted,
            fontFamily: "'Geist Sans', sans-serif",
            display: 'block',
            marginBottom: 8,
          }}
        >
          Badges
        </span>
        <BadgeDisplay earnedBadgeIds={badgesEarned} />
      </div>

      {/* Share button */}
      <div style={{ marginTop: 'auto', flexShrink: 0 }}>
        <button
          onClick={handleShare}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '8px 0',
            borderRadius: 6,
            border: `1px solid ${colors.accent}`,
            background: `${colors.accent}15`,
            color: colors.accent,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "'Geist Sans', sans-serif",
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = `${colors.accent}25`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = `${colors.accent}15`;
          }}
        >
          <Upload size={13} />
          Share Current Circuit
        </button>
      </div>
    </div>
  );
}
