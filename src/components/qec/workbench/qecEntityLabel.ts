import type { DiscoveredQecStudy } from '../../../services/qecStudyStore';
import type { QecEntityRef } from '../../../types/qecSelection';

export interface EntityLabel {
  readonly text: string;
  /** Identifiers read as code; a Study's own name reads as a name. */
  readonly mono: boolean;
}

/** What to call an entity in the trail and inspector: a Study by its name, everything else by its id. */
export function entityLabel(ref: QecEntityRef, studies: readonly DiscoveredQecStudy[]): EntityLabel {
  if (ref.kind === 'study') {
    const name = studies.find((entry) => entry.study.id === ref.id)?.study.name;
    if (name) return { text: name, mono: false };
  }
  return { text: ref.id, mono: true };
}
