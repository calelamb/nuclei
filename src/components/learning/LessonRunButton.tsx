import { Play } from 'lucide-react';
import { Button } from '../ui';
import { getRunButtonState } from '../editor/runButtonState';
import type { BootProgress } from '../../platform/pyodide/workerProtocol';

interface LessonRunButtonProps {
  isRunning: boolean;
  /** Web: Python is still booting. A press is queued and runs when it is ready. */
  pythonLoading: boolean;
  /** The boot stage with its step count, when the runtime reports one. */
  progress: BootProgress | null;
  onRun: () => void;
  /** Cancels a Run that is queued behind the boot. Without it the queued state is not offered. */
  onCancelQueued?: () => void;
}

/**
 * The Run button shared by demos and exercises. While Python boots it follows the toolbar's
 * queue model: "Run" until pressed, then "Queued · n/3" and a second press cancels.
 */
export function LessonRunButton({ isRunning, pythonLoading, progress, onRun, onCancelQueued }: LessonRunButtonProps) {
  const queued = isRunning && pythonLoading;
  const boot = getRunButtonState({
    kernelReady: !pythonLoading,
    kernelStatus: pythonLoading ? 'connecting' : 'ready',
    kernelProgress: progress,
    kernelError: null,
    isRunning: false,
    runQueued: queued,
    engine: 'Python',
  });
  const cancellable = queued && onCancelQueued !== undefined;
  const label = cancellable ? boot.label : queued ? 'Loading Python…' : isRunning ? 'Running…' : 'Run';
  const title = pythonLoading && (queued || progress) ? boot.title : undefined;
  return (
    <Button
      variant="primary"
      onClick={cancellable ? onCancelQueued : onRun}
      loading={isRunning && !cancellable}
      keepFocus
      title={title}
      aria-pressed={pythonLoading ? queued : undefined}
      icon={<Play size={12} fill="currentColor" aria-hidden="true" />}
    >
      {label}
    </Button>
  );
}
