import { useEffect, useRef } from 'react';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import { ProblemBrowser } from './ProblemBrowser';
import { ProblemWorkspace } from './ProblemWorkspace';
import { ChevronLeft, Trophy } from 'lucide-react';
import { Button } from '../ui';
import './challenges.css';

export function ChallengeModeView() {
  const activeProblem = useChallengeModeStore((s) => s.activeProblem);
  const setActiveProblem = useChallengeModeStore((s) => s.setActiveProblem);
  const exitChallengeMode = useChallengeModeStore((s) => s.exitChallengeMode);

  const problemTitleRef = useRef<HTMLSpanElement>(null);
  const previousIdRef = useRef<string | null>(activeProblem?.id ?? null);
  const activeId = activeProblem?.id ?? null;

  // Keyboard focus follows the learner: the problem title when one opens, its row when Back returns to the list.
  useEffect(() => {
    const previous = previousIdRef.current;
    previousIdRef.current = activeId;
    if (previous === activeId) return;
    if (activeId) {
      problemTitleRef.current?.focus({ preventScroll: true });
      return;
    }
    const row = previous ? document.querySelector<HTMLElement>(`[data-problem-id="${CSS.escape(previous)}"]`) : null;
    row?.scrollIntoView({ block: 'nearest' });
    row?.focus({ preventScroll: true });
  }, [activeId]);

  return (
    <div className="cmode">
      <div className="cmode__bar">
        <Button
          size="sm"
          variant="ghost"
          icon={<ChevronLeft size={14} aria-hidden="true" />}
          onClick={activeProblem ? () => setActiveProblem(null) : exitChallengeMode}
        >
          Back
        </Button>

        <span className="cmode__sep" aria-hidden="true" />
        <Trophy className="cmode__trophy" size={16} aria-hidden="true" />
        {/* The takeover title is the landing heading for keyboard routes: focus lands here, ring-free. */}
        <h1 className="cmode__title" data-landing tabIndex={-1}>Quantum challenges</h1>

        {activeProblem && (
          <>
            <span className="cmode__sep" aria-hidden="true" />
            <span ref={problemTitleRef} className="cmode__problem" role="heading" aria-level={2} data-landing tabIndex={-1}>{activeProblem.title}</span>
          </>
        )}
      </div>

      <div className="cmode__content">
        {activeProblem ? <ProblemWorkspace key={activeProblem.id} /> : <ProblemBrowser />}
      </div>
    </div>
  );
}
