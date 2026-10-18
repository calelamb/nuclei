import { LoaderCircle } from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import { useQecStudyStore } from '../../../services/qecStudyStore';
import { useNavigationStore } from '../../../stores/navigationStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useQecStore } from '../../../stores/qecStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import { ICON_SIZE, ICON_STROKE } from '../../../styles/tokens';
import { Button } from '../../ui';
import { circuitHint } from './circuitHint';
import { CIRCUIT_LOAD_TIMEOUT_MS, nextOpenPhase, type OpenFeedbackPhase } from './openFeedback';
import { useOpenSource } from './useOpenSource';

function showInEditor(): void {
  useNavigationStore.getState().setActiveView('files');
}

/** What happens after the file is open: a loading line with a way to the editor, then an honest reason if nothing arrives. */
function OpenProgress({ phase, onRetry }: { phase: Exclude<OpenFeedbackPhase, 'idle'>; onRetry: () => void }): ReactElement {
  const link = <button type="button" className="qec-instrument__link" onClick={showInEditor}>Show in editor</button>;
  if (phase === 'loading') {
    return (
      <span className="qec-instrument__hint" role="status">
        <LoaderCircle className="nuclei-spin" aria-hidden="true" size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} /> Loading circuit… It is open in the editor. {link}
      </span>
    );
  }
  return (
    <span className="qec-instrument__hint" role="alert">
      No circuit came back. Stim may not be available in this kernel, so the file is open in the editor but cannot be drawn here.
      <span className="qec-open-circuit__actions">{link}<span aria-hidden="true"> · </span><Button size="sm" variant="secondary" onClick={onRetry}>Try again</Button></span>
    </span>
  );
}

/** One click to the circuit when the active Study names exactly one; otherwise say where the files are. */
export function OpenCircuitAction(): ReactElement {
  const studies = useQecStudyStore((state) => state.studies);
  const activeStudyId = useQecStudyUiStore((state) => state.activeStudyId);
  const { open, error } = useOpenSource();
  const projectOpen = useProjectStore((state) => state.projectRoot !== null);
  const hasCircuit = useQecStore((state) => state.snapshot !== null);
  const [pending, setPhase] = useState<OpenFeedbackPhase>('idle');
  // A parsed circuit ends the wait: the card is replaced by the figure itself.
  const phase = hasCircuit ? nextOpenPhase(pending, 'circuit') : pending;
  const study = studies.find((entry) => entry.study.id === activeStudyId)?.study ?? null;
  const circuits = study?.sources.filter((source) => source.kind === 'stim') ?? [];

  useEffect(() => {
    if (phase !== 'loading') return undefined;
    const timer = window.setTimeout(() => setPhase((current) => nextOpenPhase(current, 'timeout')), CIRCUIT_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (circuits.length !== 1) {
    return (
      <span className="qec-instrument__hint" data-hint>
        {circuitHint({ projectOpen, studyCount: studies.length, hasActiveStudy: study !== null, circuitCount: circuits.length })}
      </span>
    );
  }
  const circuit = circuits[0];
  const onOpen = (): void => {
    void open(circuit).then((opened) => { if (opened) setPhase((current) => nextOpenPhase(current, 'opened')); });
  };
  return (
    <span className="qec-open-circuit">
      {phase === 'idle' && <Button size="sm" variant="primary" onClick={onOpen}>{`Open ${circuit.path.split('/').pop()}`}</Button>}
      {phase !== 'idle' && <OpenProgress phase={phase} onRetry={() => setPhase('idle')} />}
      {error && <span className="qec-instrument__hint" role="alert">{error}</span>}
    </span>
  );
}
