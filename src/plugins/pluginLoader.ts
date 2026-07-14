/**
 * Plugin loader — reads a plugin folder from disk, validates its manifest,
 * blob-imports its entry module, and runs `activate(createPluginAPI(manifest))`.
 *
 * The load mechanism is: read entry JS → `Blob` → object URL → dynamic
 * `import()` → call `activate(api)`. The blob-module boundary is a *loading*
 * mechanism, NOT a trust boundary.
 *
 * SECURITY — Nuclei plugins are NOT sandboxed. `entry.js` runs as ordinary
 * JavaScript in the Nuclei webview with the same privileges as the app (full
 * DOM / `window` / `fetch`). The manifest's `permissions[]` list only gates the
 * friendly `api.getCircuit…`/`api.getEditor…` reads and is shown for transparency —
 * it is not enforcement; a plugin can reach around `api`. Plugins are LOCAL,
 * user-authored, TRUSTED code: loaded only by an explicit folder pick or a path
 * the user previously chose. There is no remote registry. The only hard checks
 * are the zod manifest validation and the `entry` path-traversal guard. Nuclei
 * protects itself from *broken* plugins (validation + per-plugin error
 * isolation) but not from *malicious* ones. Real isolation (Worker/iframe with
 * message passing) is future work — we would rather be honest than ship a fake
 * sandbox.
 *
 * NOTE: `script-src` in the Tauri CSP must include `blob:` for the dynamic
 * `import()` of a blob URL to succeed. Without it, `importPluginModule` throws
 * and the load returns a clean error instead of crashing.
 */

import { readTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { parseManifestJson, MANIFEST_FILENAME } from './manifestSchema';
import { createPluginAPI, usePluginStore } from './pluginManager';
import { persistInstalledPlugins, readPersistedPlugins } from './pluginPersistence';
import type {
  InstalledPlugin,
  PluginActivate,
  PluginCleanup,
  PluginManifest,
  PluginModule,
} from './types';

export { MANIFEST_FILENAME };

export type LoadResult =
  | { ok: true; plugin: InstalledPlugin }
  | { ok: false; error: string };

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function safeCleanup(plugin: InstalledPlugin): void {
  try {
    plugin.cleanup?.();
  } catch {
    // A broken teardown must not block a reload/disable.
  }
}

/** Last path segment of a folder path — a fallback display name. */
function nameFromSource(source: string): string {
  const parts = source.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || source;
}

function errorPlaceholder(source: string, error: string): InstalledPlugin {
  return {
    manifest: {
      name: nameFromSource(source),
      version: '0.0.0',
      description: '',
      author: '',
      entry: '',
      capabilities: ['custom-panel'],
      permissions: [],
    },
    enabled: false,
    api: null,
    source,
    status: 'error',
    error,
  };
}

/**
 * Import a plugin entry module from its JS source. PURE (no Tauri) so it is
 * unit-testable wherever `Blob` + dynamic `import()` of blob URLs work.
 * Resolves the module's `activate` (named export preferred, else default).
 */
export async function importPluginModule(entryJs: string): Promise<PluginActivate> {
  let url: string | null = null;
  try {
    url = URL.createObjectURL(new Blob([entryJs], { type: 'text/javascript' }));
    const mod = (await import(/* @vite-ignore */ url)) as PluginModule;
    const activate = mod.activate ?? mod.default;
    if (typeof activate !== 'function') {
      throw new Error(
        'plugin entry must export an `activate(api)` function (named export or default export)',
      );
    }
    return activate;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

/** Read + validate a folder's `plugin.json`. No entry load, no activation. */
async function readManifest(
  dir: string,
): Promise<{ ok: true; manifest: PluginManifest } | { ok: false; error: string }> {
  const manifestPath = await join(dir, MANIFEST_FILENAME);
  if (!(await exists(manifestPath))) {
    return { ok: false, error: `${MANIFEST_FILENAME} not found in ${dir}` };
  }
  let text: string;
  try {
    text = await readTextFile(manifestPath);
  } catch (e) {
    return { ok: false, error: `could not read ${MANIFEST_FILENAME}: ${errMsg(e)}` };
  }
  const parsed = parseManifestJson(text);
  if (!parsed.ok) {
    return { ok: false, error: `invalid ${MANIFEST_FILENAME}: ${parsed.errors.join('; ')}` };
  }
  return { ok: true, manifest: parsed.manifest };
}

/**
 * Load + activate a plugin from a folder. On any failure returns a formatted,
 * field-addressed error and registers nothing. On success returns a fully
 * formed, active `InstalledPlugin` (with live `api` + `cleanup`).
 *
 * Does NOT touch the store's `plugins` array itself — the caller decides
 * whether to `installPlugin`/`replacePlugin`. It DOES prune this plugin's
 * stale extensions before activating so a reload can't leave duplicates.
 */
export async function loadPluginFromDir(dir: string): Promise<LoadResult> {
  const m = await readManifest(dir);
  if (!m.ok) return m;
  const { manifest } = m;

  const entryPath = await join(dir, manifest.entry);
  if (!(await exists(entryPath))) {
    return { ok: false, error: `entry file "${manifest.entry}" not found in ${dir}` };
  }
  let entryJs: string;
  try {
    entryJs = await readTextFile(entryPath);
  } catch (e) {
    return { ok: false, error: `could not read entry "${manifest.entry}": ${errMsg(e)}` };
  }

  let activate: PluginActivate;
  try {
    activate = await importPluginModule(entryJs);
  } catch (e) {
    return { ok: false, error: `failed to load "${manifest.entry}": ${errMsg(e)}` };
  }

  const api = createPluginAPI(manifest);
  const store = usePluginStore.getState();
  // Clear any extensions left by a previous load of this same plugin, then
  // activate. If activate throws, prune again so nothing half-registered leaks.
  store.pruneExtensions(manifest.name);
  let cleanup: PluginCleanup | void;
  try {
    cleanup = activate(api);
  } catch (e) {
    store.pruneExtensions(manifest.name);
    return { ok: false, error: `plugin "${manifest.name}" threw during activate(): ${errMsg(e)}` };
  }

  const plugin: InstalledPlugin = {
    manifest,
    enabled: true,
    api,
    source: dir,
    status: 'active',
    cleanup: typeof cleanup === 'function' ? cleanup : undefined,
  };
  return { ok: true, plugin };
}

/**
 * User picked a folder: load it, add it to the store, and persist. Returns the
 * load result so the UI can show an error card on failure.
 */
export async function installPluginFromDir(dir: string): Promise<LoadResult> {
  const res = await loadPluginFromDir(dir);
  if (!res.ok) return res;
  usePluginStore.getState().installPlugin(res.plugin);
  await persistInstalledPlugins();
  return res;
}

/**
 * Tear down the current instance and re-load from disk (the tight authoring
 * loop / the enable path). On failure the record is kept but marked errored so
 * the UI can explain why.
 */
export async function reloadPlugin(name: string): Promise<LoadResult> {
  const store = usePluginStore.getState();
  const existing = store.plugins.find((p) => p.manifest.name === name);
  if (!existing) return { ok: false, error: `plugin "${name}" is not installed` };
  if (!existing.source) {
    return { ok: false, error: `plugin "${name}" has no source folder to reload from` };
  }

  safeCleanup(existing);
  store.pruneExtensions(name);

  const res = await loadPluginFromDir(existing.source);
  if (!res.ok) {
    store.replacePlugin({
      ...existing,
      enabled: false,
      status: 'error',
      error: res.error,
      api: null,
      cleanup: undefined,
    });
    await persistInstalledPlugins();
    return res;
  }
  store.replacePlugin(res.plugin);
  await persistInstalledPlugins();
  return res;
}

/** Enable a disabled plugin: re-activates it from disk (via reload). */
export async function enablePlugin(name: string): Promise<LoadResult> {
  return reloadPlugin(name);
}

/** Disable a plugin (store cleanup + prune) and persist the new enabled state. */
export async function disablePlugin(name: string): Promise<void> {
  usePluginStore.getState().disablePlugin(name);
  await persistInstalledPlugins();
}

/** Uninstall a plugin (store cleanup + prune + remove) and persist. */
export async function uninstallPlugin(name: string): Promise<void> {
  usePluginStore.getState().uninstallPlugin(name);
  await persistInstalledPlugins();
}

/**
 * Boot-time restore. For each persisted record: enabled → load + activate;
 * disabled → read the manifest (so it lists with its real name) without
 * activating. A missing/broken folder becomes an honest error record rather
 * than a crash or a silent drop.
 */
export async function restorePersistedPlugins(): Promise<void> {
  const records = await readPersistedPlugins();
  const store = usePluginStore.getState();

  for (const rec of records) {
    if (store.plugins.some((p) => p.source === rec.source)) continue; // already loaded

    if (rec.enabled) {
      const res = await loadPluginFromDir(rec.source);
      store.installPlugin(res.ok ? res.plugin : errorPlaceholder(rec.source, res.error));
    } else {
      const m = await readManifest(rec.source);
      store.installPlugin(
        m.ok
          ? { manifest: m.manifest, enabled: false, api: null, source: rec.source, status: 'disabled' }
          : errorPlaceholder(rec.source, m.error),
      );
    }
  }
}
