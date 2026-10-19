import type { ConfirmOptions } from '../ui';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore } from '../../stores/projectStore';
import { MEMORY_PREFIX } from '../../hooks/useFileOps';
import { STARTER_TEMPLATES } from '../../data/starterTemplates';
import type { Framework } from '../../types/quantum';

export type LoadIntoEditorResult = 'opened-tab' | 'replaced' | 'cancelled';

export interface LoadIntoEditorOptions {
  /** What is arriving, for the confirm title: "demo code", "Cirq starter", "challenge starter". */
  label: string;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  framework?: Framework;
  /** File name for the in-memory tab opened in project mode, e.g. "qrng-step1.py". */
  tabName?: string;
  /** Replaces the default "Your unsaved edits will be lost." line. */
  description?: string;
}

/** The last code this module put in the editor; unedited, it is as disposable as a starter. */
let lastLoadedCode: string | null = null;

/** True when the buffer is empty or still an untouched starter for any framework. */
export function isUntouchedStarter(code: string): boolean {
  const normalized = code.trimEnd();
  if (lastLoadedCode !== null && code === lastLoadedCode) return true;
  return normalized === '' || Object.values(STARTER_TEMPLATES).some((t) => t.trimEnd() === normalized);
}

function memoryPathFor(name: string, taken: ReadonlySet<string>): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 1;
  let path = `${MEMORY_PREFIX}${name}`;
  while (taken.has(path)) {
    n += 1;
    path = `${MEMORY_PREFIX}${base}-${n}${ext}`;
  }
  return path;
}

function defaultTabName(framework: Framework | undefined, taken: ReadonlySet<string>): string {
  const ext = framework === 'qsharp' ? 'qs' : 'py';
  let n = 1;
  while (taken.has(`${MEMORY_PREFIX}untitled-${n}.${ext}`)) n += 1;
  return `untitled-${n}.${ext}`;
}

/**
 * Puts code in the editor with no confirmation: a new in-memory tab when a project is open (the
 * open file is never written into), otherwise an untitled buffer detached from any file path.
 */
export function placeInEditor(code: string, framework: Framework | undefined, tabName?: string): LoadIntoEditorResult {
  const { tabs, openTab } = useProjectStore.getState();
  const editor = useEditorStore.getState();
  const projectMode = tabs.length > 0;
  if (projectMode) {
    const taken = new Set(tabs.map((t) => t.path));
    openTab({ path: memoryPathFor(tabName ?? defaultTabName(framework, taken), taken), content: code });
  } else {
    editor.setFilePath(null);
  }
  editor.setCode(code);
  lastLoadedCode = code;
  if (framework) editor.setFramework(framework);
  editor.requestEditorFocus();
  return projectMode ? 'opened-tab' : 'replaced';
}

/**
 * The one path every "put this code in the editor" button goes through. Never destroys work: in
 * project mode the code lands in its own tab, otherwise a dirty buffer that is not an untouched
 * starter needs an explicit confirm first.
 */
export async function loadIntoEditor(code: string, options: LoadIntoEditorOptions): Promise<LoadIntoEditorResult> {
  const projectMode = useProjectStore.getState().tabs.length > 0;
  const { code: current, isDirty } = useEditorStore.getState();
  if (!projectMode && isDirty && !isUntouchedStarter(current)) {
    const ok = await options.confirm({
      title: `Replace your code with the ${options.label}?`,
      description: options.description ?? 'Your unsaved edits will be lost.',
      confirmLabel: 'Replace',
      cancelLabel: 'Keep editing',
      tone: 'danger',
    });
    if (!ok) return 'cancelled';
  }
  return placeInEditor(code, options.framework, options.tabName);
}
