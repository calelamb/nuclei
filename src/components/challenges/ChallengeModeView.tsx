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

  return (
    <div className="cmode">
      <div className="cmode__bar">
        <Button
          size="sm"
          variant="ghost"
          icon={<ChevronLeft size={14} aria-hidden="true" />}
          onClick={activeProblem ? () => setActiveProblem(null) : exitChallengeMode}
        >
          {activeProblem ? 'Back' : 'Exit'}
        </Button>

        <span className="cmode__sep" aria-hidden="true" />
        <Trophy className="cmode__trophy" size={16} aria-hidden="true" />
        <span className="cmode__title">Quantum Challenges</span>

        {activeProblem && (
          <>
            <span className="cmode__sep" aria-hidden="true" />
            <span className="cmode__problem">{activeProblem.title}</span>
          </>
        )}
      </div>

      <div className="cmode__content">
        {activeProblem ? <ProblemWorkspace /> : <ProblemBrowser />}
      </div>
    </div>
  );
}
