import { Orbit, Play } from 'lucide-react';
import { useSimulationStore } from '../../stores/simulationStore';
import { useEditorStore } from '../../stores/editorStore';
import { useBottomPanelStore } from '../../stores/bottomPanelStore';
import { shortcutLabel } from '../../config/keybindings';
import { getExecute } from '../../App';
import { Button, EmptyState } from '../ui';
import { revealTerminalError } from '../../lib/revealTerminalError';
import { resultsEmptyVariant } from './resultsEmptyVariant';

const IDLE_COPY = "Run your circuit to see each qubit's Bloch sphere and the outcome histogram.";

/**
 * The one "no results" state, identical in every layout preset: the same copy, the same Run
 * action, centred in the space it is given. A failed run says so (with a way to the error)
 * instead of falling back to the first-run prompt.
 */
export function ResultsEmptyState() {
  const isRunning = useSimulationStore((s) => s.isRunning);
  const lastRunFailed = useSimulationStore((s) => s.lastRunFailed);
  const lastRunNoCircuit = useSimulationStore((s) => s.lastRunNoCircuit);
  const lastRunStopped = useSimulationStore((s) => s.lastRunStopped);
  const errorLine = useEditorStore((s) => s.errors[0]?.line ?? null);
  const focusTerminal = useBottomPanelStore((s) => s.focusTerminal);
  const variant = resultsEmptyVariant({ isRunning, lastRunFailed, lastRunNoCircuit, lastRunStopped });
  const showError = () => {
    focusTerminal();
    // The Terminal may only mount after it opens, so look again on the next frame.
    if (!revealTerminalError()) requestAnimationFrame(() => { revealTerminalError(); });
  };
  const run = () => getExecute()?.();
  const runLabel = `Run ${shortcutLabel('run') ?? ''}`.trim();

  if (variant === 'running') {
    return (
      <div role="status" className="viz-results-empty">
        <EmptyState className="viz-empty" icon={<Orbit size={20} style={{ animation: 'nuclei-heartbeat 1.5s ease infinite' }} />} title="Running…" />
      </div>
    );
  }
  if (variant === 'failed') {
    return (
      <div role="status" className="viz-results-empty">
        <EmptyState
          className="viz-empty"
          icon={<Orbit size={20} />}
          title="Last run failed"
          action={(
            <div className="viz-results-empty__actions">
              <Button variant="secondary" size="sm" onClick={showError}>Show error</Button>
              <Button variant="ghost" size="sm" icon={<Play size={12} />} onClick={run}>Run again</Button>
            </div>
          )}
        >
          {errorLine !== null ? `Stopped at line\u00A0${errorLine} · nothing was plotted` : 'Stopped with an error · nothing was plotted'}
        </EmptyState>
      </div>
    );
  }
  if (variant === 'stopped') {
    return (
      <div role="status" className="viz-results-empty">
        <EmptyState
          className="viz-empty"
          icon={<Orbit size={20} />}
          title="Run stopped"
          action={<Button variant="secondary" size="sm" icon={<Play size={12} />} onClick={run}>Run again</Button>}
        >
          Nothing was plotted for this run.
        </EmptyState>
      </div>
    );
  }
  if (variant === 'no-circuit') {
    return (
      <div role="status" className="viz-results-empty">
        <EmptyState
          className="viz-empty"
          icon={<Orbit size={20} />}
          title="No circuit in this file"
          action={<Button variant="secondary" size="sm" icon={<Play size={12} />} onClick={run}>{runLabel}</Button>}
        >
          It ran as plain Python. Define a circuit to see it here.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="viz-results-empty">
      <EmptyState
        className="viz-empty"
        icon={<Orbit size={20} />}
        title="No results yet"
        action={<Button variant="secondary" size="sm" icon={<Play size={12} />} onClick={run}>{runLabel}</Button>}
      >
        {IDLE_COPY}
      </EmptyState>
    </div>
  );
}
