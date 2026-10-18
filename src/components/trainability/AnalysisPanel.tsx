import type { ReactNode } from 'react';
import { Ban, FlaskConical, Hourglass } from 'lucide-react';
import { LabCallout, LabEmptyState, LabProgress, LabSkeleton } from '../lab';
import type { TrainabilityAnalysis, TrainabilityResults } from '../../types/trainability';
import type { AnalysisView } from './analysisState';

/**
 * Shared empty / loading / error scaffold for every analysis tab, so no tab
 * ever renders a blank box. `children` renders only for the `ready` state.
 */
export function AnalysisPanel<K extends TrainabilityAnalysis>({
  view,
  title,
  emptyBody,
  children,
}: {
  view: AnalysisView<K>;
  title: string;
  emptyBody: string;
  children: (data: NonNullable<TrainabilityResults[K]>, running: boolean) => ReactNode;
}) {
  switch (view.kind) {
    case 'empty':
      return <LabEmptyState icon={FlaskConical} title={`${title}: nothing to show yet`} body={emptyBody} compact />;
    case 'skipped':
      return (
        <LabEmptyState
          icon={FlaskConical}
          title={`${title} was not requested`}
          body="Enable it in the target bar and run the analyses again."
          compact
        />
      );
    case 'cancelled':
      return (
        <LabEmptyState
          icon={Ban}
          title="Not run (cancelled)"
          body={`${title} was cancelled before it finished. Run the analyses again to compute it.`}
          compact
        />
      );
    case 'loading':
      return (
        <div className="lab-stack" role="status" aria-live="polite" aria-label={`${title} is running`}>
          <div className="lab-row" style={{ gap: 'var(--space-2)', color: 'var(--color-text-secondary)' }}>
            <Hourglass size={14} aria-hidden />
            <span>{view.message ?? `Running ${title.toLowerCase()}…`}</span>
          </div>
          <LabProgress value={view.fraction} label={`${title} progress`} />
          <LabSkeleton height={180} />
          <LabSkeleton height={12} width="70%" />
        </div>
      );
    case 'error':
      return (
        <LabCallout tone="danger" title={`${title} failed`}>
          <span className="lab-mono">{view.code}</span>: {view.message}
        </LabCallout>
      );
    case 'ready':
      return <>{children(view.data, view.running)}</>;
  }
}
