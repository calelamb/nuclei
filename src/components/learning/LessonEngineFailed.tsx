import './lessonEngineFailed.css';
import { RotateCcw } from 'lucide-react';
import { Button } from '../ui';
import { describeKernelFailure } from '../../lib/kernelErrors';
import { usePlatform } from '../../platform/PlatformProvider';

interface LessonEngineFailedProps {
  /** Why the start failed, from the shared kernel status. */
  detail: string | null;
  onRetry: () => void;
}

/**
 * The one "Python didn't start" state for demos, exercises and challenges: the canonical
 * title, the reason, and an explicit Retry. Never a permanent "Starting 1/3".
 */
export function LessonEngineFailed({ detail, onRetry }: LessonEngineFailedProps) {
  const isWeb = usePlatform().getPlatform() === 'web';
  const failure = describeKernelFailure(detail ?? '', { isWeb });
  return (
    <div className="lesson-engine-failed" role="alert">
      <div className="lesson-engine-failed__text">
        <strong className="lesson-engine-failed__title">{failure.title}</strong>
        {detail ? <span className="lesson-engine-failed__detail">{failure.detail}</span> : null}
      </div>
      <Button size="sm" icon={<RotateCcw size={12} aria-hidden="true" />} onClick={onRetry}>Retry</Button>
    </div>
  );
}
