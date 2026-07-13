import { mkdir, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { useProjectStore } from '../stores/projectStore';
import { noiseModelToYaml, type NoiseModelDef } from '../types/noiseModel';
import { slugify } from '../components/experiments/experimentFormHelpers';

export interface DuplicateResult {
  ok: boolean;
  error?: string;
  relPath?: string;
}

/**
 * PRD 10 Phase F — "duplicate to edit" a noise model. Writes an editable
 * `noise/<slug>.noise.yaml` carrying the source model's channels under a new
 * name and opens it in the editor. The file is the source of truth; the
 * library re-discovers it from disk. Never overwrites an existing file.
 */
export async function duplicateNoiseModel(
  source: NoiseModelDef,
  newName: string,
  projectRoot: string,
): Promise<DuplicateResult> {
  const name = newName.trim();
  if (!name) return { ok: false, error: 'Give the copy a name.' };
  const slug = slugify(name) || 'noise-model';
  const relPath = `noise/${slug}.noise.yaml`;
  const abs = await join(projectRoot, relPath);

  if (await exists(abs)) {
    return { ok: false, error: `${relPath} already exists — pick a different name.` };
  }

  const content = noiseModelToYaml({ ...source, name, builtin: false });
  try {
    const noiseDir = await join(projectRoot, 'noise');
    await mkdir(noiseDir, { recursive: true });
    await writeTextFile(abs, content);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  useProjectStore.getState().openTab({ path: abs, content });
  return { ok: true, relPath };
}
