import { useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Lightbulb, Play } from 'lucide-react';
import { useCapstoneStore } from '../../stores/capstoneStore';
import { useEditorStore } from '../../stores/editorStore';
import { Button } from '../ui';
import './learnSidebar.css';

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}...` : text);

export function CapstoneProjectView() {
  const { activeProject, activeMilestoneIndex, completedMilestones, completeMilestone, exitProject } = useCapstoneStore();
  const setCode = useEditorStore((s) => s.setCode);
  const [revealedHints, setRevealedHints] = useState(0);

  if (!activeProject) return null;

  const projectCompleted = completedMilestones[activeProject.id] ?? [];
  const currentMilestone = activeProject.milestones[activeMilestoneIndex];

  const showNextHint = () => {
    if (currentMilestone && revealedHints < currentMilestone.hints.length) {
      setRevealedHints((h) => h + 1);
    }
  };

  const loadStarter = () => {
    if (currentMilestone) {
      setCode(currentMilestone.starterCode);
    }
  };

  const handleComplete = () => {
    completeMilestone();
    setRevealedHints(0);
  };

  return (
    <div className="capv">
      <div className="capv__head">
        <Button size="sm" variant="ghost" icon={<ArrowLeft size={12} aria-hidden="true" />} onClick={exitProject}>
          Back to projects
        </Button>
        <div className="capv__title">{activeProject.title}</div>
        <div className="capv__desc">{truncate(activeProject.description, 120)}</div>
      </div>

      <div className="capv__body">
        {activeProject.milestones.map((milestone, i) => {
          const isCompleted = projectCompleted.includes(milestone.id);
          const isCurrent = i === activeMilestoneIndex;
          const state = isCompleted ? 'done' : isCurrent ? 'current' : 'future';

          return (
            <div key={milestone.id} className="capv__step" data-state={state}>
              <div className="capv__step-row">
                <div className="capv__num" aria-hidden="true">{isCompleted ? '\u2713' : i + 1}</div>
                <div className="capv__step-body">
                  <div className="capv__step-title">
                    {isCurrent ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
                    {milestone.title}
                  </div>

                  {isCurrent && (
                    <div>
                      <div className="capv__step-desc">{milestone.description}</div>
                      <div className="capv__actions">
                        <Button size="sm" variant="primary" icon={<Play size={12} aria-hidden="true" />} onClick={loadStarter}>Load starter code</Button>
                        <Button size="sm" onClick={handleComplete}>Mark complete</Button>
                      </div>

                      {milestone.hints.slice(0, revealedHints).map((hint, hi) => (
                        <div key={hi} className="capv__hint">
                          <Lightbulb size={12} aria-hidden="true" />
                          <span>{hint}</span>
                        </div>
                      ))}
                      {revealedHints < milestone.hints.length && (
                        <Button size="sm" variant="ghost" className="capv__link" icon={<Lightbulb size={12} aria-hidden="true" />} onClick={showNextHint}>
                          Show hint ({revealedHints + 1}/{milestone.hints.length})
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {i < activeProject.milestones.length - 1 && <div className="capv__line" />}
            </div>
          );
        })}

        {activeProject.diracGuidancePrompt && (
          <div className="capv__dirac">
            <div className="capv__dirac-title">Dirac guidance</div>
            <div className="capv__dirac-text">{truncate(activeProject.diracGuidancePrompt, 200)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
