import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import { isStateVerified } from '../../services/challengeGrading';
import { ProblemDescription } from './ProblemDescription';
import { ProblemEditor } from './ProblemEditor';
import { TestRunner } from './TestRunner';
import { HintPanel } from './HintPanel';
import { SubmissionHistory } from './SubmissionHistory';
import { Badge } from '../ui';
import { DIFFICULTY_TONE } from './difficultyTone';
import './challenges.css';

type WorkspaceTab = 'description' | 'submissions' | 'hints';

function WorkspaceTabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="tab" aria-selected={active} className="trun__tab" onClick={onClick}>
      {label}
    </button>
  );
}

const DIVIDER_MIN = 28;
const DIVIDER_MAX = 72;
const DIVIDER_KEY_STEP = 2;

export function ProblemWorkspace() {
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
      const next = Math.max(DIVIDER_MIN, Math.min(DIVIDER_MAX, startPercent + deltaPercent));
      setDividerX(next);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [dividerX]);

  const handleDividerKey = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? -DIVIDER_KEY_STEP : DIVIDER_KEY_STEP;
    setDividerX((x) => Math.max(DIVIDER_MIN, Math.min(DIVIDER_MAX, x + delta)));
  };

  if (!activeProblem) return null;

  const submissions = progress[activeProblem.id]?.submissions ?? [];
  const visibleTests = activeProblem.visible_tests ?? activeProblem.testCases.filter((test) => !test.hidden);
  const hiddenTests = activeProblem.hidden_tests ?? activeProblem.testCases.filter((test) => test.hidden);
  const isValueContract = activeProblem.contract_kind === 'returns_value';
  return (
    <div className="pwork">
      <div className="pwork__head">
        <div className="pwork__head-main">
          <div className="pwork__chips">
            <Badge tone={DIFFICULTY_TONE[activeProblem.difficulty]} style={{ textTransform: 'capitalize' }}>{activeProblem.difficulty}</Badge>
            <span className="pwork__category">{activeProblem.category.replace('-', ' ')}</span>
            {isStateVerified(activeProblem) && (
              <Badge
                tone="success"
                icon={<ShieldCheck size={12} aria-hidden="true" />}
                title="Graded on the actual quantum state (fidelity / oracle), so it can't be passed by hardcoding the answer."
              >
                State-verified
              </Badge>
            )}
          </div>
          <div className="pwork__title">{activeProblem.title}</div>
        </div>

        <div className="pwork__meta">
          {isValueContract && (
            <>
              <Badge tone="accent">Python value contract</Badge>
              <Badge tone="success">Browser + Desktop</Badge>
            </>
          )}
          <span>{visibleTests.length} visible / {hiddenTests.length} hidden</span>
          <span>{submissions.length} submissions</span>
        </div>
      </div>

      <div className="pwork__split" style={{ flex: bottomExpanded ? 0.66 : 1 }}>
        <div className="pwork__left" style={{ width: `${dividerX}%` }}>
          <div className="pwork__tabs" role="tablist" aria-label="Problem sections">
            <WorkspaceTabButton active={tab === 'description'} label="Description" onClick={() => setTab('description')} />
            <WorkspaceTabButton active={tab === 'submissions'} label={`Submissions (${submissions.length})`} onClick={() => setTab('submissions')} />
            <WorkspaceTabButton active={tab === 'hints'} label={`Hints (${activeProblem.hints.length})`} onClick={() => setTab('hints')} />
          </div>

          <div className="pwork__pane" role="tabpanel">
            {tab === 'description' && <ProblemDescription challenge={activeProblem} />}
            {tab === 'submissions' && (
              <div className="pwork__scroll"><SubmissionHistory submissions={submissions} /></div>
            )}
            {tab === 'hints' && (
              <div className="pwork__scroll"><HintPanel hints={activeProblem.hints} /></div>
            )}
          </div>
        </div>

        <div
          className="pwork__divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize problem and editor"
          aria-valuemin={DIVIDER_MIN}
          aria-valuemax={DIVIDER_MAX}
          aria-valuenow={Math.round(dividerX)}
          tabIndex={0}
          onMouseDown={handleDividerDrag}
          onKeyDown={handleDividerKey}
        />

        <div className="pwork__editor">
          <ProblemEditor challenge={activeProblem} />
        </div>
      </div>

      <button type="button" className="pwork__toggle" aria-expanded={bottomExpanded} onClick={() => setBottomExpanded((open) => !open)}>
        {bottomExpanded ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
        Test Results
      </button>

      {bottomExpanded && (
        <div className="pwork__results">
          <TestRunner challenge={activeProblem} />
        </div>
      )}
    </div>
  );
}
