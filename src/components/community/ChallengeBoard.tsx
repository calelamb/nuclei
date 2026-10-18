import { Badge, Button, EmptyState, SegmentedControl, Table, Tbody, Td, Th, Thead, Tr, type BadgeTone } from '../ui';
import { useThemeStore } from '../../stores/themeStore';
import { useChallengeStore } from '../../stores/challengeStore';
import { useEditorStore } from '../../stores/editorStore';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { Play, Lightbulb, Trophy } from 'lucide-react';
import { ICON_SIZE, ICON_STROKE } from '../../styles/tokens';

import { TYPOGRAPHY } from '../../styles/tokens';
const DIFFICULTY_TONE: Record<string, BadgeTone> = {
  beginner: 'success',
  intermediate: 'warning',
  advanced: 'danger',
};

function hasEnded(deadline: string): boolean {
  return new Date(deadline).getTime() - Date.now() <= 0;
}

function formatCountdown(deadline: string): string {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return 'Ended';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h left`;
  return `${hours}h left`;
}

export function ChallengeBoard() {
  const colors = useThemeStore((s) => s.colors);
  const challenges = useChallengeStore((s) => s.challenges);
  const activeChallenge = useChallengeStore((s) => s.activeChallenge);
  const leaderboard = useChallengeStore((s) => s.leaderboard);
  const setActiveChallenge = useChallengeStore((s) => s.setActiveChallenge);
  const setCode = useEditorStore((s) => s.setCode);
  const openDirac = useDiracPanelStore((s) => s.open);

  const displayed = activeChallenge ?? challenges[0] ?? null;
  const ended = displayed ? hasEnded(displayed.deadline) : false;

  const handleStart = () => {
    if (displayed) {
      setCode(displayed.starterCode);
      setActiveChallenge(displayed);
    }
  };

  const handleHint = () => {
    openDirac();
  };

  if (!displayed) {
    return (
      <EmptyState
        icon={<Trophy size={ICON_SIZE.lg} strokeWidth={ICON_STROKE} />}
        title="No challenges yet"
      >
        Weekly challenges show up here when they are published.
      </EmptyState>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      {/* Challenge selector pills */}
      {challenges.length > 1 && (
        <div style={{ flexShrink: 0 }}>
          <SegmentedControl
            aria-label="Challenge week"
            value={displayed.id}
            options={challenges.map((ch) => ({ value: ch.id, label: `W${ch.weekNumber}` }))}
            onChange={(id) => {
              const next = challenges.find((ch) => ch.id === id);
              if (next) setActiveChallenge(next);
            }}
          />
        </div>
      )}

      {/* Active challenge card */}
      <div
        style={{
          background: colors.bgElevated,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: colors.text,
              fontFamily: TYPOGRAPHY.fontSans,
              flex: 1,
              minWidth: 0,
            }}
          >
            {displayed.title}
          </span>
          <Badge tone={DIFFICULTY_TONE[displayed.difficulty] ?? 'neutral'} style={{ textTransform: 'capitalize', flexShrink: 0 }}>{displayed.difficulty}</Badge>
        </div>

        <p
          style={{
            fontSize: 11,
            color: colors.textMuted,
            fontFamily: TYPOGRAPHY.fontSans,
            lineHeight: 1.5,
            margin: 0,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {displayed.description}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              fontSize: 11,
              color: colors.textDim,
              fontFamily: TYPOGRAPHY.fontSans,
            }}
          >
            {formatCountdown(displayed.deadline)}
          </span>
          {displayed.submissions !== undefined && (
            <span
              style={{
                fontSize: 11,
                color: colors.textDim,
                fontFamily: TYPOGRAPHY.fontSans,
              }}
            >
              {displayed.submissions} {displayed.submissions === 1 ? 'submission' : 'submissions'}
            </span>
          )}
        </div>

        {/* Actions stack so the labels never wrap in the narrow rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button variant={ended ? 'secondary' : 'primary'} size="sm" icon={<Play size={ICON_SIZE.xs} aria-hidden="true" />} onClick={handleStart} style={{ width: '100%' }}>
            {ended ? 'Practice this challenge' : 'Start challenge'}
          </Button>
          <Button variant="secondary" size="sm" icon={<Lightbulb size={ICON_SIZE.xs} aria-hidden="true" />} onClick={handleHint} style={{ width: '100%' }}>
            Ask Dirac
          </Button>
        </div>
      </div>

      {/* Leaderboard */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Trophy size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} style={{ color: colors.accentText }} aria-hidden="true" />
          <h3 className="nuclei-overline">Leaderboard</h3>
        </div>

        {leaderboard.length === 0 ? (
          <p style={{ margin: 0, padding: 16, textAlign: 'center', fontSize: 12, color: colors.textMuted }}>
            No submissions yet. Be the first.
          </p>
        ) : (
          <Table label="Leaderboard" dense>
            <Thead>
              <Tr>
                <Th plain>#</Th>
                <Th plain>Name</Th>
                <Th plain numeric>Score</Th>
              </Tr>
            </Thead>
            <Tbody>
              {leaderboard.map((entry) => (
                <Tr key={entry.rank}>
                  <Td numeric>{entry.rank}</Td>
                  <Td text>{entry.displayName}</Td>
                  <Td numeric>{entry.score}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </div>
    </div>
  );
}
