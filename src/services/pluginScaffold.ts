/**
 * Plugin scaffold — write a working, dependency-free starter plugin (a
 * `plugin.json` + `entry.js` that registers a live custom panel) into a
 * user-chosen folder, open the entry in the editor, then load it so the panel
 * appears immediately. Mirrors `qecScaffold.ts`: never overwrite, then show the
 * author editable code so the plugin is not a black box.
 */

import { mkdir, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { useProjectStore } from '../stores/projectStore';
import { MANIFEST_FILENAME } from '../plugins/manifestSchema';
import { installPluginFromDir, type LoadResult } from '../plugins/pluginLoader';
import type { PluginManifest } from '../plugins/types';

/** Slugify an author-supplied name into a kebab-case plugin id. */
export function slugifyPluginName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'my-plugin';
}

/** The starter entry module — a working panel that tracks the live circuit. */
export const STARTER_ENTRY_JS = `// Nuclei plugin entry — a single-file, dependency-free ES module.
// Everything you need arrives through \`api\`; there is no bare \`import\`.
export function activate(api) {
  api.registerPanel({
    id: 'starter-panel',
    title: 'Starter Panel',
    render(container) {
      const el = document.createElement('div');
      el.style.cssText = 'padding:12px;font:12px system-ui;color:inherit';

      const paint = (snapshot) => {
        el.textContent = snapshot
          ? \`Qubits: \${snapshot.qubit_count} · Depth: \${snapshot.depth} · Gates: \${snapshot.gates.length}\`
          : 'No circuit yet — start typing quantum code.';
      };

      paint(api.getCircuitSnapshot());
      const unsubscribe = api.onCircuitChange(paint);
      container.appendChild(el);

      // Optional: return a cleanup run when the panel unmounts.
      return unsubscribe;
    },
  });

  api.log('starter plugin activated');

  // Optional: return a cleanup run when the plugin is disabled/uninstalled.
  return () => api.log('starter plugin deactivated');
}
`;

function starterManifest(slug: string): PluginManifest {
  return {
    name: slug,
    version: '0.1.0',
    description: 'A starter Nuclei plugin with a live circuit panel.',
    author: '',
    entry: 'entry.js',
    capabilities: ['custom-panel'],
    permissions: ['read-circuit'],
  };
}

export interface ScaffoldPluginResult {
  ok: boolean;
  /** The created plugin folder, on success. */
  dir?: string;
  error?: string;
  /** The load result of the freshly-written plugin (so the UI can surface load errors). */
  load?: LoadResult;
}

/**
 * Create a starter plugin folder under `targetDir`, open its entry in the
 * editor, and load it. Refuses to overwrite an existing plugin folder.
 */
export async function scaffoldPlugin(
  name: string,
  targetDir: string,
): Promise<ScaffoldPluginResult> {
  const slug = slugifyPluginName(name);
  const dir = await join(targetDir, slug);
  const manifestPath = await join(dir, MANIFEST_FILENAME);
  const entryPath = await join(dir, 'entry.js');

  if (await exists(manifestPath)) {
    return { ok: false, error: `${slug}/${MANIFEST_FILENAME} already exists — pick a different name.` };
  }

  const manifestText = JSON.stringify(starterManifest(slug), null, 2) + '\n';
  try {
    await mkdir(dir, { recursive: true });
    await writeTextFile(manifestPath, manifestText);
    await writeTextFile(entryPath, STARTER_ENTRY_JS);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Show the author editable code immediately (not a black box), then load the
  // plugin so its panel appears live.
  useProjectStore.getState().openTab({ path: entryPath, content: STARTER_ENTRY_JS });
  const load = await installPluginFromDir(dir);

  return { ok: true, dir, load };
}
