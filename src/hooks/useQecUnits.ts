import { useMemo } from 'react';
import { useQecCampaignStore } from '../stores/qecCampaignStore';
import { roundsFromMetadata, type RateUnits } from '../lib/qecFit';

export interface QecUnits {
  /** Units actually in force: the request, unless rounds are unknown. */
  units: RateUnits;
  /** True when at least one row records rounds, so per-round is possible. */
  roundsKnown: boolean;
  requested: RateUnits;
  setRequested: (units: RateUnits) => void;
}

/** One source of truth for per-shot vs per-round across the plot, the Λ
 * readout and the Decoder Workbench. */
export function useQecUnits(): QecUnits {
  const rowsByStrongId = useQecCampaignStore((s) => s.rowsByStrongId);
  const requested = useQecCampaignStore((s) => s.requestedUnits);
  const setRequested = useQecCampaignStore((s) => s.setRequestedUnits);
  const roundsKnown = useMemo(
    () => Object.values(rowsByStrongId).some((r) => roundsFromMetadata(r.json_metadata) !== null),
    [rowsByStrongId],
  );
  return { units: roundsKnown ? requested : 'per_shot', roundsKnown, requested, setRequested };
}
