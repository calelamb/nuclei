import { useState } from 'react';
import type { SimulationResult } from '../../types/quantum';
import { SegmentedControl, type SegmentedOption } from '../ui';
import { ProbabilityBars } from './ProbabilityBars';
import { sampledProbabilities, type DistributionKind } from './outcomeDistribution';

const OPTIONS: ReadonlyArray<SegmentedOption<DistributionKind>> = [
  { value: 'sampled', label: 'Sampled' },
  { value: 'ideal', label: 'Ideal' },
];

/**
 * Outcome bars for a lesson run. Shows what the shots actually measured (so
 * repeated runs differ the way real hardware does) with an Ideal toggle for
 * the exact amplitudes.
 */
export function OutcomeResults({ result }: { result: SimulationResult }) {
  const [kind, setKind] = useState<DistributionKind>('sampled');
  const sampled = sampledProbabilities(result);
  const showing: DistributionKind = sampled ? kind : 'ideal';
  const probabilities = showing === 'sampled' && sampled ? sampled : result.probabilities;

  return (
    <div className="outcomes">
      {sampled && (
        <div className="outcomes__head">
          <span className="outcomes__meta">
            {showing === 'sampled' ? `${result.shot_count.toLocaleString()} shots` : 'Exact amplitudes'}
          </span>
          <SegmentedControl aria-label="Outcome distribution" value={showing} options={OPTIONS} onChange={setKind} />
        </div>
      )}
      <ProbabilityBars probabilities={probabilities} />
    </div>
  );
}
