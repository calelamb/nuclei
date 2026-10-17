import type { RateUnits } from '../../lib/qecFit';
import { SegmentedControl } from '../ui/SegmentedControl';

const OPTIONS: ReadonlyArray<{ value: RateUnits; label: string }> = [
  { value: 'per_shot', label: 'Per shot' },
  { value: 'per_round', label: 'Per round' },
];

/** Per shot / per round switch shared by the plot, Λ readout and decoder table. */
export function QecUnitsToggle({ units, onChange }: { units: RateUnits; onChange: (u: RateUnits) => void }) {
  return <SegmentedControl aria-label="Logical error units" value={units} options={OPTIONS} onChange={onChange} />;
}
