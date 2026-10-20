import { isResultStale, useSimulationStore } from '../stores/simulationStore';
import { useEditorStore } from '../stores/editorStore';

/** True while the Bloch spheres and histogram show a run of code that has since changed. */
export function useResultStale(): boolean {
  const hasResult = useSimulationStore((s) => s.result !== null);
  const resultCode = useSimulationStore((s) => s.resultCode);
  const code = useEditorStore((s) => s.code);
  return isResultStale(resultCode, code, hasResult);
}
