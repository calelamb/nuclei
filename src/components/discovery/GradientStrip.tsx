import { LabSectionLabel, formatSci, seqColor } from '../lab';
import { deadGradientLines } from '../../services/discovery/gradient';
import { describeMethod } from '../../services/discovery/format';
import type { GradientMap } from '../../types/discovery';

const DEAD_VARIANCE = 1e-8;

/** Log-scaled 0..1 position of a variance between the dead threshold and the map's maximum. */
function varianceLevel(variance: number, max: number): number {
  if (!(variance > 0) || !(max > 0)) return 0;
  const lo = Math.log10(DEAD_VARIANCE);
  const hi = Math.log10(Math.max(max, DEAD_VARIANCE * 10));
  return Math.min(1, Math.max(0, (Math.log10(variance) - lo) / (hi - lo)));
}

/**
 * Addendum §C: the trusted evaluator's per-line gradient map as a compact
 * strip, one cell per program line. Dead lines (variance below 1e-8, or the
 * dead-parameter rule) are hatched and outlined.
 */
export function GradientStrip({ map, totalLines }: { map: GradientMap; totalLines: number }) {
  const byLine = new Map(map.lines.map((l) => [l.line, l]));
  const max = Math.max(...map.lines.map((l) => l.variance), 0);
  const dead = deadGradientLines(map);
  const lines = Math.max(totalLines, ...map.lines.map((l) => l.line), 1);
  const summary = `Gradient map over ${lines} program lines (${describeMethod(map.method)}, ${map.n_qubits} qubits): ${map.lines.length} lines carry parameters, ${dead.length} are dead (${(map.dead_fraction * 100).toFixed(0)}% of parameterized lines).`;
  return (
    <div>
      <LabSectionLabel>Gradient map</LabSectionLabel>
      <div role="img" aria-label="Per-line gradient variance" aria-describedby="gradient-strip-summary" className="disc-gradient" style={{ marginTop: 'var(--space-2)' }}>
        {Array.from({ length: lines }, (_, i) => {
          const line = i + 1;
          const entry = byLine.get(line);
          const classes = ['disc-gradient__cell', entry?.dead ? 'disc-gradient__cell--dead' : entry ? 'disc-gradient__cell--live' : ''].filter(Boolean).join(' ');
          return (
            <span
              key={line}
              className={classes}
              title={entry ? `Line ${line}: variance ${formatSci(entry.variance, 2)}${entry.dead ? ' (dead)' : ''}` : `Line ${line}: no parameters`}
              style={entry && !entry.dead ? { background: seqColor(varianceLevel(entry.variance, max)) } : undefined}
            />
          );
        })}
      </div>
      <p id="gradient-strip-summary" className="lab-muted" style={{ margin: 'var(--space-2) 0 0', fontSize: 11.5 }}>
        {summary}
        {dead.length > 0 && (
          <>
            {' '}Dead lines: <span className="lab-mono">{dead.map((l) => l.line).join(', ')}</span>.
          </>
        )}
      </p>
    </div>
  );
}
