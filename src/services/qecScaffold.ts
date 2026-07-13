import { mkdir, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { useProjectStore } from '../stores/projectStore';
import { useExperimentStore } from './experimentStore';
import { useExperimentUiStore } from '../stores/experimentUiStore';
import { createTauriExperimentFs } from './experimentFs';
import type { QecTemplate } from './qecTemplates';

export interface ScaffoldResult {
  ok: boolean;
  error?: string;
  /** experiments/<slug>.experiment.yaml, on success. */
  yamlFileName?: string;
}

/**
 * PRD 10 Phase F — write a QEC template's real files into the project, open
 * the stim-generating entry in the editor, and select the new campaign in the
 * Experiments rail. Never overwrites: if either target exists the whole
 * scaffold is refused so a stray click can't clobber edited work.
 */
export async function scaffoldQecExperiment(
  template: QecTemplate,
  name: string,
  projectRoot: string,
): Promise<ScaffoldResult> {
  const scaffold = template.build(name);

  // Refuse if anything we would write already exists.
  for (const file of scaffold.files) {
    const abs = await join(projectRoot, file.relPath);
    if (await exists(abs)) {
      return { ok: false, error: `${file.relPath} already exists — pick a different name.` };
    }
  }

  try {
    for (const file of scaffold.files) {
      const abs = await join(projectRoot, file.relPath);
      const dir = abs.slice(0, abs.length - (file.relPath.split('/').pop()?.length ?? 0));
      await mkdir(dir, { recursive: true });
      await writeTextFile(abs, file.content);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Reload so the new campaign appears, then open the entry source and select
  // the campaign — the student sees editable code immediately, not a black box.
  await useExperimentStore.getState().reload(projectRoot, createTauriExperimentFs());

  const entryFile = scaffold.files.find((f) => f.language === 'python');
  if (entryFile) {
    const abs = await join(projectRoot, entryFile.relPath);
    useProjectStore.getState().openTab({ path: abs, content: entryFile.content });
  }

  const yamlFileName = scaffold.yamlRelPath.split('/').pop();
  if (yamlFileName) {
    useExperimentUiStore.getState().selectExperiment(yamlFileName);
  }

  return { ok: true, yamlFileName };
}
