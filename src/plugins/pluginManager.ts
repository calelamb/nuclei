/**
 * Plugin Manager — the store of installed plugins + their registered
 * extensions, plus `createPluginAPI` (the API surface a plugin's
 * `activate(api)` receives).
 *
 * This module is deliberately I/O-free and synchronous: it holds state and
 * runs pure reducers. Disk reads, blob-module loading, and re-activation live
 * in `pluginLoader.ts` (Tauri) and `pluginPersistence.ts`. Keeping the store
 * pure makes the reducers (dedupe / disable-cleanup / uninstall-prune)
 * straightforward to unit-test in a plain Node environment.
 */

import { create } from 'zustand';
import { useCircuitStore } from '../stores/circuitStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useEditorStore } from '../stores/editorStore';
import type { PluginManifest, PluginAPI, InstalledPlugin } from './types';

// Registry for plugin-contributed extensions. Panels + themes render for real
// in v1; diracSkills are stored but not yet injected (v1.1).
export interface PluginExtensions {
  panels: Array<{
    pluginName: string;
    id: string;
    title: string;
    render: (container: HTMLElement) => (() => void) | void;
  }>;
  diracSkills: Array<{ pluginName: string; name: string; systemPromptFragment: string; tools?: unknown[] }>;
  themes: Array<{ pluginName: string; name: string; colors: Record<string, string> }>;
}

interface PluginManagerState {
  plugins: InstalledPlugin[];
  extensions: PluginExtensions;

  /**
   * Add a plugin. Overloaded for back-compat:
   *  - `installPlugin(plugin)` — the loader's fully-formed `InstalledPlugin`
   *    (carries a live `api` + `source` + `status`).
   *  - `installPlugin(manifest, source)` — legacy shape (no live api); kept so
   *    existing callers compile until they migrate to the object form.
   * Deduplicated by `manifest.name`.
   */
  installPlugin(plugin: InstalledPlugin): void;
  installPlugin(manifest: PluginManifest, source: string): void;

  /** Replace an existing plugin record by name (used by reload), else append. */
  replacePlugin: (plugin: InstalledPlugin) => void;

  /** Run cleanup, prune extensions, remove the plugin entirely. */
  uninstallPlugin: (name: string) => void;

  /** Run cleanup + prune extensions, keep the record but mark it disabled. */
  disablePlugin: (name: string) => void;

  /**
   * Toggle enabled state. Disabling runs cleanup + prunes extensions.
   * Enabling only flips the flag — repopulating panels/themes requires
   * re-activation, which is async/Tauri and lives in `pluginLoader.enablePlugin`.
   */
  togglePlugin: (name: string) => void;

  /** Remove all extensions contributed by a plugin (used before re-activation). */
  pruneExtensions: (name: string) => void;

  setPlugins: (plugins: InstalledPlugin[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerExtension: (type: keyof PluginExtensions, ext: any) => void;
}

/** Run a plugin's cleanup without letting a broken teardown block the op. */
function runCleanup(plugin: InstalledPlugin): void {
  try {
    plugin.cleanup?.();
  } catch {
    // A plugin's cleanup throwing must never prevent disable/uninstall.
  }
}

/** Pure: drop every extension contributed by `name`. */
function pruneExtensionsFor(ext: PluginExtensions, name: string): PluginExtensions {
  return {
    panels: ext.panels.filter((p) => p.pluginName !== name),
    diracSkills: ext.diracSkills.filter((p) => p.pluginName !== name),
    themes: ext.themes.filter((p) => p.pluginName !== name),
  };
}

export const usePluginStore = create<PluginManagerState>((set, get) => ({
  plugins: [],
  extensions: { panels: [], diracSkills: [], themes: [] },

  installPlugin: (a: InstalledPlugin | PluginManifest, source?: string) => {
    const plugin: InstalledPlugin =
      'manifest' in a
        ? a
        : {
            manifest: a,
            enabled: true,
            api: null,
            source: source ?? '',
            status: 'active',
          };
    if (get().plugins.some((p) => p.manifest.name === plugin.manifest.name)) return;
    set((s) => ({ plugins: [...s.plugins, plugin] }));
  },

  replacePlugin: (plugin) =>
    set((s) => ({
      plugins: s.plugins.some((p) => p.manifest.name === plugin.manifest.name)
        ? s.plugins.map((p) => (p.manifest.name === plugin.manifest.name ? plugin : p))
        : [...s.plugins, plugin],
    })),

  uninstallPlugin: (name) => {
    const target = get().plugins.find((p) => p.manifest.name === name);
    if (target) runCleanup(target);
    set((s) => ({
      plugins: s.plugins.filter((p) => p.manifest.name !== name),
      extensions: pruneExtensionsFor(s.extensions, name),
    }));
  },

  disablePlugin: (name) => {
    const target = get().plugins.find((p) => p.manifest.name === name);
    if (!target) return;
    runCleanup(target);
    set((s) => ({
      plugins: s.plugins.map((p) =>
        p.manifest.name === name
          ? { ...p, enabled: false, status: 'disabled', api: null, cleanup: undefined }
          : p,
      ),
      extensions: pruneExtensionsFor(s.extensions, name),
    }));
  },

  togglePlugin: (name) => {
    const target = get().plugins.find((p) => p.manifest.name === name);
    if (!target) return;
    if (target.enabled) {
      get().disablePlugin(name);
    } else {
      set((s) => ({
        plugins: s.plugins.map((p) =>
          p.manifest.name === name ? { ...p, enabled: true } : p,
        ),
      }));
    }
  },

  pruneExtensions: (name) =>
    set((s) => ({ extensions: pruneExtensionsFor(s.extensions, name) })),

  setPlugins: (plugins) => set({ plugins }),

  registerExtension: (type, ext) =>
    set((s) => ({
      extensions: { ...s.extensions, [type]: [...s.extensions[type], ext] },
    })),
}));

// ---------------------------------------------------------------------------
// Selectors — the registered panels/themes that belong to *enabled* plugins.
// Consumers should wrap these in `useShallow` when used as a Zustand selector
// (they return freshly-filtered arrays):
//   usePluginStore(useShallow(selectEnabledPanels))
// ---------------------------------------------------------------------------

export function selectEnabledPanels(s: PluginManagerState): PluginExtensions['panels'] {
  const on = new Set(s.plugins.filter((p) => p.enabled).map((p) => p.manifest.name));
  return s.extensions.panels.filter((p) => on.has(p.pluginName));
}

export function selectEnabledThemes(s: PluginManagerState): PluginExtensions['themes'] {
  const on = new Set(s.plugins.filter((p) => p.enabled).map((p) => p.manifest.name));
  return s.extensions.themes.filter((p) => on.has(p.pluginName));
}

/** Non-React getters (for the loader / services). */
export const getEnabledPanels = (): PluginExtensions['panels'] =>
  selectEnabledPanels(usePluginStore.getState());
export const getEnabledThemes = (): PluginExtensions['themes'] =>
  selectEnabledThemes(usePluginStore.getState());

/**
 * Create the API surface for a specific plugin. Reused unchanged by the loader
 * — `loadPluginFromDir` calls this and passes the result to `activate(api)`.
 *
 * NOTE: `permissions` gating here is a courtesy, not a security boundary — see
 * the SECURITY note in `types.ts`. It only controls what the friendly getters
 * return; a plugin already runs with full app privileges.
 */
export function createPluginAPI(manifest: PluginManifest): PluginAPI {
  const hasPermission = (perm: string) =>
    (manifest.permissions as string[]).includes(perm);

  return {
    getCircuitSnapshot() {
      if (!hasPermission('read-circuit')) return null;
      return useCircuitStore.getState().snapshot;
    },

    getSimulationResult() {
      if (!hasPermission('read-results')) return null;
      return useSimulationStore.getState().result;
    },

    getEditorCode() {
      if (!hasPermission('read-editor')) return '';
      return useEditorStore.getState().code;
    },

    getFramework() {
      return useEditorStore.getState().framework;
    },

    onCircuitChange(callback) {
      if (!hasPermission('read-circuit')) return () => {};
      return useCircuitStore.subscribe((state) => {
        if (state.snapshot) callback(state.snapshot);
      });
    },

    onResultChange(callback) {
      if (!hasPermission('read-results')) return () => {};
      return useSimulationStore.subscribe((state) => {
        if (state.result) callback(state.result);
      });
    },

    registerPanel(config) {
      if (!manifest.capabilities.includes('custom-panel')) return;
      usePluginStore.getState().registerExtension('panels', {
        pluginName: manifest.name,
        ...config,
      });
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    registerGateRenderer(_config) {
      if (!manifest.capabilities.includes('gate-renderer')) return;
      // Stored intent only — gate-renderer registration is not consumed in v1
      // (v1.1 will wire it to the circuit renderer).
    },

    registerDiracSkill(config) {
      if (!manifest.capabilities.includes('dirac-skill')) return;
      // Stored but NOT injected into Dirac's system prompt in v1 (v1.1).
      usePluginStore.getState().registerExtension('diracSkills', {
        pluginName: manifest.name,
        ...config,
      });
    },

    registerTheme(config) {
      if (!manifest.capabilities.includes('theme')) return;
      usePluginStore.getState().registerExtension('themes', {
        pluginName: manifest.name,
        ...config,
      });
    },

    log(message) {
      if (import.meta.env.DEV) console.log(`[Plugin:${manifest.name}] ${message}`);
    },
  };
}
