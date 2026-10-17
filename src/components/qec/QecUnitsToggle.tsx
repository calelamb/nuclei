import type { RateUnits } from '../../lib/qecFit';
import { Button } from '../ui';

const OPTIONS: ReadonlyArray<readonly [RateUnits, string]> = [['per_shot', 'Per shot'], ['per_round', 'Per round']];

/** Per shot / per round switch shared by the plot, Λ readout and decoder table. */
export function QecUnitsToggle({ units, onChange }: { units: RateUnits; onChange: (u: RateUnits) => void }) {
  return (
    <div role="group" aria-label="Logical error units" style={{ display: 'flex', gap: 2 }}>
      {OPTIONS.map(([u, text]) => (
        <Button
          key={u}
          size="sm"
          variant={units === u ? 'primary' : 'secondary'}
          aria-pressed={units === u}
          onClick={() => onChange(u)}
        >
          {text}
        </Button>
      ))}
    </div>
  );
}
