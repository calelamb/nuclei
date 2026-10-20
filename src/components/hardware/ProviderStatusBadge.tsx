import { Badge, type BadgeTone } from '../ui';
import type { ProviderStatus, ProviderStatusKind } from './launchGating';

const TONE: Record<ProviderStatusKind, BadgeTone> = {
  ready: 'success',
  starting: 'neutral',
  unavailable: 'danger',
  'needs-setup': 'warning',
  'desktop-only': 'neutral',
  'coming-soon': 'neutral',
};

/** One label and colour map for provider state, shared by the Hardware panel and the Launch dialog. */
export function ProviderStatusBadge({ status }: { status: ProviderStatus }) {
  return (
    <Badge tone={TONE[status.kind]} data-status={status.kind}>
      {status.label}
    </Badge>
  );
}
