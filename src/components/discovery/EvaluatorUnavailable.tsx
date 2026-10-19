import { PackagePlus } from 'lucide-react';
import { LabButton } from '../lab';
import { isDesktop } from '../../services/environment';
import { unavailableInstructions, unavailableSummary } from '../../services/discovery/availability';
import { useFrameworksStore } from '../../stores/frameworksStore';
import type { DiscoveryEvaluatorInfo } from '../../types/discovery';

/**
 * Explains that an evaluator needs optional packages, with a button into the in-app Environment
 * installer (desktop) or plain instructions (web). Not an alert: it is a persistent property of the
 * card or panel, not an event.
 */
export function EvaluatorUnavailable({ info, showSummary = true }: { info: DiscoveryEvaluatorInfo; showSummary?: boolean }) {
  const openModal = useFrameworksStore((s) => s.openModal);
  return (
    <span data-testid="evaluator-unavailable" style={{ display: 'grid', gap: 6, fontSize: 12, lineHeight: 1.5 }}>
      {showSummary && <strong>{unavailableSummary(info)}</strong>}
      <span className="lab-muted">{unavailableInstructions(info)}</span>
      {isDesktop() && (
        <span>
          <LabButton
            variant="secondary"
            size="sm"
            icon={PackagePlus}
            onClick={(e) => {
              e.stopPropagation();
              openModal(false);
            }}
          >
            Open Environment setup
          </LabButton>
        </span>
      )}
    </span>
  );
}
