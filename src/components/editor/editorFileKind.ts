/** What the editor toolbar should offer for the active file. */
export type EditorFileKind = 'runnable' | 'experiment' | 'other';

const RUNNABLE_EXTENSIONS = ['.py', '.qs', '.stim', '.qasm'] as const;
const EXPERIMENT_SUFFIX = '.experiment.yaml';

/**
 * Classifies the active tab. No path (the unsaved starter buffer) is runnable;
 * an experiment manifest gets the experiment Run control; everything else
 * (README.md, data files) is plain text with no framework, Launch or Run.
 */
export function editorFileKind(path: string | null | undefined): EditorFileKind {
  if (!path) return 'runnable';
  const lower = path.toLowerCase();
  if (lower.endsWith(EXPERIMENT_SUFFIX)) return 'experiment';
  return RUNNABLE_EXTENSIONS.some((ext) => lower.endsWith(ext)) ? 'runnable' : 'other';
}
