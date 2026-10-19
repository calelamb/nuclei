import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Lightbulb, Play } from 'lucide-react';
import { useCapstoneStore } from '../../stores/capstoneStore';
import { useLearnStore } from '../../stores/learnStore';
import { Button, useConfirm } from '../ui';
import { loadIntoEditor, type LoadIntoEditorResult } from '../editor/loadIntoEditor';
import './capstoneView.css';

type StepState = 'done' | 'current' | 'future';

/** Which step's starter was last loaded, and where it landed. Cleared when the learner moves on. */
interface LoadedNote { milestoneId: string; outcome: Exclude<LoadIntoEditorResult, 'cancelled'> }

export function CapstoneProjectView() {
  const { activeProject, activeMilestoneIndex, completedMilestones, completeMilestone, exitProject } = useCapstoneStore();
  const exitLearnMode = useLearnStore((s) => s.exitLearnMode);
  const { confirm, confirmDialog } = useConfirm();
  const [revealedHints, setRevealedHints] = useState(0);
  // Steps the learner folded or unfolded by hand; every other step is open only while it is current.
  const [manualOpen, setManualOpen] = useState<Readonly<Record<string, boolean>>>({});
  const [loaded, setLoaded] = useState<LoadedNote | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const stepTitleRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const focusCurrentStepRef = useRef(false);

  const projectId = activeProject?.id;
  const currentId = activeProject?.milestones[activeMilestoneIndex]?.id;
  const completedCount = projectId ? (completedMilestones[projectId] ?? []).length : 0;

  // Start project lands on the project title, so keyboard focus follows the learner into the page.
  useEffect(() => {
    if (projectId) titleRef.current?.focus({ preventScroll: true });
  }, [projectId]);

  // Mark complete removes its own button, so focus moves to the step the learner is on now.
  useEffect(() => {
    if (!focusCurrentStepRef.current || !currentId) return;
    focusCurrentStepRef.current = false;
    stepTitleRefs.current[currentId]?.focus();
  }, [currentId, completedCount]);

  if (!activeProject) return null;

  const projectCompleted = completedMilestones[activeProject.id] ?? [];
  const currentMilestone = activeProject.milestones[activeMilestoneIndex];
  const allDone = activeProject.milestones.every((m) => projectCompleted.includes(m.id));

  const isStepOpen = (id: string) => manualOpen[id] ?? id === currentId;
  const toggleStep = (id: string) => setManualOpen((prev) => ({ ...prev, [id]: !(prev[id] ?? id === currentId) }));

  const showNextHint = () => {
    if (currentMilestone && revealedHints < currentMilestone.hints.length) setRevealedHints((h) => h + 1);
  };

  const loadStarter = async () => {
    if (!currentMilestone) return;
    const outcome = await loadIntoEditor(currentMilestone.starterCode, {
      label: 'step starter',
      confirm,
      tabName: `${currentMilestone.id}.py`,
    });
    if (outcome !== 'cancelled') setLoaded({ milestoneId: currentMilestone.id, outcome });
  };

  const handleComplete = () => {
    focusCurrentStepRef.current = true;
    // The finished step folds away on its own: it is no longer current.
    setManualOpen({});
    completeMilestone();
    setRevealedHints(0);
    setLoaded(null);
  };

  const renderStepBody = (milestoneId: string, isCurrent: boolean, isCompleted: boolean) => {
    const milestone = activeProject.milestones.find((m) => m.id === milestoneId);
    if (!milestone) return null;
    const note = loaded?.milestoneId === milestoneId ? loaded : null;
    return (
      <div className="capv__step-content">
        <p className="capv__step-desc">{milestone.description}</p>
        {isCurrent && (
          <>
            <div className="capv__actions">
              <Button variant="primary" icon={<Play size={12} aria-hidden="true" />} onClick={() => { void loadStarter(); }}>Load starter code</Button>
              {!isCompleted && <Button onClick={handleComplete}>Mark complete</Button>}
            </div>
            <div className="capv__loaded" role="status">
              {note && (
                <>
                  <span>{note.outcome === 'opened-tab' ? 'Starter loaded in a new tab.' : 'Starter loaded in the editor.'}</span>
                  <Button size="sm" variant="ghost" onClick={exitLearnMode}>Open editor</Button>
                </>
              )}
            </div>
            {milestone.hints.slice(0, revealedHints).map((hint, hi) => (
              <div key={hi} className="capv__hint">
                <Lightbulb size={12} aria-hidden="true" />
                <span>{hint}</span>
              </div>
            ))}
            {revealedHints < milestone.hints.length && (
              <Button variant="ghost" className="capv__hint-btn" icon={<Lightbulb size={12} aria-hidden="true" />} onClick={showNextHint}>
                Show hint ({revealedHints}/{milestone.hints.length})
              </Button>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="capv">
      <header className="capv__head">
        <Button size="sm" variant="ghost" icon={<ArrowLeft size={12} aria-hidden="true" />} onClick={exitProject}>
          Back to projects
        </Button>
        <h2 ref={titleRef} tabIndex={-1} className="capv__title">{activeProject.title}</h2>
        <p className="capv__desc">{activeProject.description}</p>
        <p className="capv__progress" role="status">
          {allDone ? 'Project complete.' : `${projectCompleted.length} of ${activeProject.milestones.length} steps complete`}
        </p>
      </header>

      <ol className="capv__steps" aria-label="Project steps">
        {activeProject.milestones.map((milestone, i) => {
          const isCompleted = projectCompleted.includes(milestone.id);
          const isCurrent = i === activeMilestoneIndex;
          const state: StepState = isCompleted ? 'done' : isCurrent ? 'current' : 'future';
          const open = isStepOpen(milestone.id);

          return (
            <li key={milestone.id} className="capv__step" data-state={state}>
              <div className="capv__num" aria-hidden="true">{isCompleted ? '✓' : i + 1}</div>
              <div className="capv__step-body">
                <button
                  type="button"
                  ref={(el) => { stepTitleRefs.current[milestone.id] = el; }}
                  className="capv__step-title"
                  aria-expanded={open}
                  aria-current={isCurrent ? 'step' : undefined}
                  onClick={() => toggleStep(milestone.id)}
                >
                  {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
                  <span>{milestone.title}</span>
                  {isCompleted && <span className="capv__done-tag">Done</span>}
                </button>
                {open && renderStepBody(milestone.id, isCurrent, isCompleted)}
              </div>
            </li>
          );
        })}
      </ol>
      {confirmDialog}
    </div>
  );
}
