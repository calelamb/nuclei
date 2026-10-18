import { Play } from 'lucide-react';
import { Button } from '../ui';

interface LessonRunButtonProps {
  isRunning: boolean;
  /** Web: Python is still booting. A press is queued and runs when it is ready. */
  pythonLoading: boolean;
  stage: string | null;
  onRun: () => void;
}

/** The Run button shared by demos and exercises: honest about waiting for Python on the web. */
export function LessonRunButton({ isRunning, pythonLoading, stage, onRun }: LessonRunButtonProps) {
  const waiting = isRunning && pythonLoading;
  const label = waiting ? 'Loading Python…' : isRunning ? 'Running…' : 'Run';
  return (
    <Button
      variant="primary"
      onClick={onRun}
      loading={isRunning}
      title={waiting ? `${stage ?? 'Python is still loading'}. Your code runs as soon as Python is ready.` : undefined}
      icon={<Play size={12} fill="currentColor" aria-hidden="true" />}
    >
      {label}
    </Button>
  );
}
