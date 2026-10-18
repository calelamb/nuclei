import { formatInterval, formatSci } from '../../lab';
import type { EvidenceRow } from '../../../types/conjecture';
import { OutcomePill } from './pills';
import { Sparkline } from './Sparkline';

const TONE = { meets: 'success', violates: 'danger', indeterminate: 'warning' } as const;
const FEATURE_ORDER = ['n_layers', 'entangler_pattern', 'entangler', 'rotation_axes', 'two_qubit_gates_per_layer'];

function featureText(features: Record<string, unknown>): string {
  const keys = [...FEATURE_ORDER.filter((k) => k in features), ...Object.keys(features).filter((k) => !FEATURE_ORDER.includes(k))].slice(0, 4);
  return keys.map((k) => `${k.replace(/_/g, ' ')} ${typeof features[k] === 'object' ? '…' : String(features[k])}`).join(' · ');
}

/** One row per held-out circuit, streamed in as the kernel finishes each. */
export function EvidenceList({ rows, expected }: { rows: EvidenceRow[]; expected?: number }) {
  if (rows.length === 0) return null;
  return (
    <ul className="cj-evidence" aria-label={`Evidence from ${rows.length}${expected ? ` of ${expected}` : ''} held-out circuits`}>
      {rows.map((row) => (
        <li key={row.circuitIndex} className="cj-evidence__row" data-outcome={row.outcome}>
          <span className="cj-evidence__num" title="Held-out circuit">#{row.circuitIndex + 1}</span>
          <span className="cj-evidence__features" title={featureText(row.features)}>{featureText(row.features) || 'no features reported'}</span>
          <span className="cj-evidence__num">
            {row.beta === null ? 'β —' : `β ${formatSci(row.beta, 2)}`} {formatInterval(row.betaCi)}
          </span>
          <OutcomePill outcome={row.outcome} />
          <span className="cj-evidence__spark">
            <Sparkline points={row.points} label={`Circuit ${row.circuitIndex + 1} scaling`} tone={TONE[row.outcome]} />
          </span>
        </li>
      ))}
    </ul>
  );
}
