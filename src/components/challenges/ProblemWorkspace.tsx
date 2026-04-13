import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import { ProblemDescription } from './ProblemDescription';
import { ProblemEditor } from './ProblemEditor';
import { TestRunner } from './TestRunner';
import { HintPanel } from './HintPanel';
import { SubmissionHistory } from './SubmissionHistory';
import type { ChallengeDifficulty } from '../../types/challenge';

const DIFFICULTY_COLORS: Record<ChallengeDifficulty, string> = {
  easy: '#10B981',
  medium: '#F59E0B',
  hard: '#EF4444',
};

type WorkspaceTab = 'description' | 'submissions' | 'hints';

function WorkspaceTabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);

  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 12px',
        background: 'transparent',
        border: 'none',
        borderBottom: active ? `2px solid ${colors.accent}` : '2px solid transparent',
        color: active ? colors.text : colors.textMuted,
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        fontFamily: "'Geist Sans', sans-serif",
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

export function ProblemWorkspace() {
  const colors = useThemeStore((s) => s.colors);
  const activeProblem = useChallengeModeStore((s) => s.activeProblem);
  const progress = useChallengeModeStore((s) => s.progress);
  const [tab, setTab] = useState<WorkspaceTab>('description');
  const [bottomExpanded, setBottomExpanded] = useState(true);
  const [dividerX, setDividerX] = useState(44);

  const handleDividerDrag = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startPercent = dividerX;

    const onMove = (moveEvent: MouseEvent) => {
      const container = (event.target as HTMLElement).parentElement;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const delta = moveEvent.clientX - startX;
      const deltaPercent = (delta / rect.width) * 100;
      const next = Math.max(28, Math.min(72, startPercent + deltaPercent));
      setDividerX(next);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [dividerX]);

  if (!activeProblem) return null;

  const submissions = progress[activeProblem.id]?.submissions ?? [];
  const visibleTests = activeProblem.visible_tests ?? activeProblem.testCases.filter((test) => !test.hidden);
  const hiddenTests = activeProblem.hidden_tests ?? activeProblem.testCases.filter((test) => test.hidden);
  const diffColor = DIFFICULTY_COLORS[activeProblem.difficulty];

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: colors.bg,
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bgPanel,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{
              padding: '3px 8px',
              borderRadius: 999,
              background: `${diffColor}18`,
              color: diffColor,
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "'Geist Sans', sans-serif",
              textTransform: 'capitalize',
            }}>
              {activeProblem.difficulty}
            </span>
            <span style={{
              color: colors.textMuted,
              fontSize: 11,
              fontFamily: "'Geist Sans', sans-serif",
              textTransform: 'uppercase',
              letterSpacing: 0.4,
            }}>
              {activeProblem.category.replace('-', ' ')}
            </span>
          </div>
          <div style={{
            color: colors.text,
            fontSize: 18,
            fontWeight: 700,
            fontFamily: "'Geist Sans', sans-serif",
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {activeProblem.title}
          </div>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          color: colors.textMuted,
          fontSize: 12,
          fontFamily: "'Geist Sans', sans-serif",
        }}>
          <span>{Math.round(activeProblem.acceptanceRate * 100)}% acceptance</span>
          <span>{visibleTests.length} visible / {hiddenTests.length} hidden</span>
          <span>{submissions.length} submissions</span>
        </div>
      </div>

      <div style={{
        flex: bottomExpanded ? 0.66 : 1,
        minHeight: 0,
        display: 'flex',
        overflow: 'hidden',
      }}>
        <div style={{ width: `${dividerX}%`, minWidth: 280, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '0 12px',
            borderBottom: `1px solid ${colors.border}`,
            background: colors.bgPanel,
            flexShrink: 0,
          }}>
            <WorkspaceTabButton active={tab === 'description'} label="Description" onClick={() => setTab('description')} />
            <WorkspaceTabButton active={tab === 'submissions'} label={`Submissions (${submissions.length})`} onClick={() => setTab('submissions')} />
            <WorkspaceTabButton active={tab === 'hints'} label={`Hints (${activeProblem.hints.length})`} onClick={() => setTab('hints')} />
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {tab === 'description' && <ProblemDescription challenge={activeProblem} />}
            {tab === 'submissions' && (
              <div style={{ height: '100%', overflowY: 'auto', padding: '20px 24px 48px' }}>
                <SubmissionHistory submissions={submissions} />
              </div>
            )}
            {tab === 'hints' && (
              <div style={{ height: '100%', overflowY: 'auto', padding: '20px 24px 48px' }}>
                <HintPanel hints={activeProblem.hints} />
              </div>
            )}
          </div>
        </div>

        <div
          onMouseDown={handleDividerDrag}
          style={{
            width: 5,
            cursor: 'col-resize',
            background: colors.border,
            flexShrink: 0,
          }}
          onMouseEnter={(event) => { event.currentTarget.style.background = colors.accent; }}
          onMouseLeave={(event) => { event.currentTarget.style.background = colors.border; }}
        />

        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <ProblemEditor challenge={activeProblem} />
        </div>
      </div>

      <button
        onClick={() => setBottomExpanded((open) => !open)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 16px',
          background: colors.bgPanel,
          border: 'none',
          borderTop: `1px solid ${colors.border}`,
          color: colors.textMuted,
          fontSize: 11,
          fontFamily: "'Geist Sans', sans-serif",
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {bottomExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Test Results
      </button>

      {bottomExpanded && (
        <div style={{ flex: 0.34, minHeight: 170, overflow: 'hidden' }}>
          <TestRunner challenge={activeProblem} />
        </div>
      )}
    </div>
  );
}
