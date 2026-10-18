import { LabCallout } from '../lab';
import { earlyStopNotice } from '../../services/discovery/format';
import { FRONTIER_HONESTY } from '../../services/discovery/honesty';
import type { RunView } from '../../stores/discoveryStore';

const WARNING = /fell back|no api key|failed|could not|error|stale|missing/i;
const COLLAPSE_AFTER = 3;

/** Runner notices, the run's failure message and the Frontier honesty line. */
export function RunNotices({ view }: { view: RunView }) {
  const { run, notices } = view;
  const frontier = run.spec.evaluator.kind === 'trainability_frontier';
  const message = run.message && !notices.includes(run.message) ? run.message : null;
  const stop = earlyStopNotice(run);
  const withStop = stop && stop !== message && !notices.includes(stop) ? [...notices, stop] : notices;
  const all = message ? [message, ...withStop] : withStop;
  const shown = all.slice(-COLLAPSE_AFTER);
  const hidden = all.slice(0, Math.max(0, all.length - COLLAPSE_AFTER));
  return (
    <div className="lab-stack" style={{ gap: 'var(--space-2)' }}>
      {frontier && (
        <LabCallout tone="info" title="Read this score as a lead, not a result">
          {FRONTIER_HONESTY}
        </LabCallout>
      )}
      {run.status === 'stale' && (
        <LabCallout tone="warning" title="This run is stale">
          The app closed while it was active. The saved state is intact; resume to continue from the last completed generation.
        </LabCallout>
      )}
      {shown.length > 0 && (
        <section aria-label="Run notices" className="lab-stack" style={{ gap: 'var(--space-2)' }}>
          {shown.map((n) => (
            <LabCallout key={n} tone={run.status === 'failed' && n === run.message ? 'danger' : WARNING.test(n) ? 'warning' : 'info'}>
              {n}
            </LabCallout>
          ))}
          {hidden.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', minHeight: 28 }}>{hidden.length} earlier notice{hidden.length === 1 ? '' : 's'}</summary>
              <ul style={{ margin: 0, paddingLeft: 'var(--space-4)' }}>
                {hidden.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
