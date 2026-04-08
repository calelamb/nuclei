import { useState, useCallback } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import { ProblemDescription } from './ProblemDescription';
import { ProblemEditor } from './ProblemEditor';
import { TestRunner } from './TestRunner';
import { HintPanel } from './HintPanel';
import { SubmissionHistory } from './SubmissionHistory';
import { Lightbulb, History, ChevronDown, ChevronRight } from 'lucide-react';
import type { ChallengeDifficulty } from '../../types/challenge';

const DIFFICULTY_COLORS: Record<ChallengeDifficulty, string> = {
  easy: '#10B981',
  medium: '#F59E0B',
  hard: '#EF4444',
};

export function ProblemWorkspace() {
  const colors = useThemeStore((s) => s.colors);
  const activeProblem = useChallengeModeStore((s) => s.activeProblem);
  const progress = useChallengeModeStore((s) => s.progress);

  const [showHints, setShowHints] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [bottomExpanded, setBottomExpanded] = useState(true);
  const [dividerX, setDividerX] = useState(45);

  const handleDividerDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startPercent = dividerX;

    const onMove = (moveEv: MouseEvent) => {
      const container = (e.target as HTMLElement).parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const delta = moveEv.clientX - startX;
      const pctDelta = (delta / rect.width) * 100;
      const next = Math.max(25, Math.min(75, startPercent + pctDelta));
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

  const diffColor = DIFFICULTY_COLORS[activeProblem.difficulty];
  const submissions = progress[activeProblem.id]?.submissions ?? [];

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Secondary toolbar */}
      <div style={{
        height: 36,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 10,
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bgPanel,
      }}>
        <span style={{
          padding: '2px 8px',
          borderRadius: 4,
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
          color: colors.text,
          fontSize: 13,
          fontWeight: 500,
          fontFamily: "'Geist Sans', sans-serif",
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {activeProblem.title}
        </span>

        {/* Hint toggle */}
        <button
          onClick={() => { setShowHints(!showHints); setShowHistory(false); }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 10px',
            borderRadius: 4,
            border: `1px solid ${showHints ? colors.warning : colors.border}`,
            background: showHints ? `${colors.warning}12` : 'transparent',
            color: showHints ? colors.warning : colors.textMuted,
            fontSize: 11,
            fontFamily: "'Geist Sans', sans-serif",
            cursor: 'pointer',
            transition: 'all 150ms ease',
          }}
        >
          <Lightbulb size={12} />
          Hints ({activeProblem.hints.length})
        </button>

        {/* History toggle */}
        {submissions.length > 0 && (
          <button
            onClick={() => { setShowHistory(!showHistory); setShowHints(false); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 10px',
              borderRadius: 4,
              border: `1px solid ${showHistory ? colors.accent : colors.border}`,
              background: showHistory ? `${colors.accent}12` : 'transparent',
              color: showHistory ? colors.accent : colors.textMuted,
              fontSize: 11,
              fontFamily: "'Geist Sans', sans-serif",
              cursor: 'pointer',
              transition: 'all 150ms ease',
            }}
          >
            <History size={12} />
            History ({submissions.length})
          </button>
        )}
      </div>

      {/* Hints/History overlay panels */}
      {showHints && (
        <div style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bgElevated,
          maxHeight: 200,
          overflowY: 'auto',
        }}>
          <HintPanel hints={activeProblem.hints} />
        </div>
      )}
      {showHistory && (
        <div style={{
          padding: '12px 16px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bgElevated,
          maxHeight: 240,
          overflowY: 'auto',
        }}>
          <SubmissionHistory submissions={submissions} />
        </div>
      )}

      {/* Main content area: description + editor */}
      <div style={{
        flex: bottomExpanded ? 0.65 : 1,
        display: 'flex',
        overflow: 'hidden',
        position: 'relative',
        minHeight: 0,
      }}>
        {/* Left pane: description */}
        <div style={{
          width: `${dividerX}%`,
          overflow: 'hidden',
        }}>
          <ProblemDescription challenge={activeProblem} />
        </div>

        {/* Resizable divider */}
        <div
          onMouseDown={handleDividerDrag}
          style={{
            width: 5,
            cursor: 'col-resize',
            background: colors.border,
            flexShrink: 0,
            transition: 'background 150ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = colors.accent; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = colors.border; }}
        />

        {/* Right pane: editor */}
        <div style={{
          flex: 1,
          overflow: 'hidden',
          minWidth: 0,
        }}>
          <ProblemEditor challenge={activeProblem} />
        </div>
      </div>

      {/* Bottom pane toggle */}
      <button
        onClick={() => setBottomExpanded(!bottomExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 16px',
          background: colors.bgPanel,
          borderTop: `1px solid ${colors.border}`,
          borderBottom: bottomExpanded ? `1px solid ${colors.border}` : 'none',
          border: 'none',
          borderTopWidth: 1,
          borderTopStyle: 'solid',
          borderTopColor: colors.border,
          color: colors.textMuted,
          fontSize: 11,
          fontFamily: "'Geist Sans', sans-serif",
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {bottomExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Test Results
      </button>

      {/* Bottom pane: test runner */}
      {bottomExpanded && (
        <div style={{
          flex: 0.35,
          overflow: 'hidden',
          minHeight: 120,
        }}>
          <TestRunner challenge={activeProblem} />
        </div>
      )}
    </div>
  );
}
