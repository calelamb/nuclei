/** Reads the live stores and builds the Dirac trainability context (Research only; the caller guards the mode). */

import { useEditorStore } from '../../stores/editorStore';
import { useTrainabilityStore } from '../../stores/trainabilityStore';
import { buildTrainabilityContext } from './context';
import { codeKey } from './hash';

export function buildTrainabilityContextFromStores(): string {
  const { code, framework, filePath } = useEditorStore.getState();
  const lab = useTrainabilityStore.getState();
  const job = lab.displayedJob();
  const editorName = filePath ? (filePath.split(/[\\/]/).pop() ?? null) : null;
  return buildTrainabilityContext({
    fileName: job?.target.fileName ?? editorName,
    observable: lab.observable,
    inspection: lab.inspect.data,
    job,
    diagnostics: lab.lint.diagnostics,
    stale: job ? job.codeKey !== codeKey(`${framework}\n${code}`) : false,
  });
}
