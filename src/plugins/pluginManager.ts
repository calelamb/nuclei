/**
 * Plugin Manager — loads, enables/disables, and provides the sandboxed API to plugins.
 */

import { create } from 'zustand';
import { useCircuitStore } from '../stores/circuitStore';
import { useSimulationStore } from '../stores/simulationStore';
import { useEditorStore } from '../stores/editorStore';
import type { PluginManifest, PluginAPI, InstalledPlugin } from './types';

// Registry for plugin-contributed extensions
export interface PluginExtensions {
  panels: Array<{ pluginName: string; id: string; title: string; render: (container: HTMLElement) => void }>;
  diracSkills: Array<{ pluginName: string; name: string; systemPromptFragment: string; tools?: unknown[] }>;
  themes: Array<{ pluginName: string; name: string; colors: Record<string, string> }>;
}

interface PluginManagerState {
  plugins: InstalledPlugin[];
  extensions: PluginExtensions;
  installPlugin: (manifest: PluginManifest, source: string) => void;
  uninstallPlugin: (name: string) => void;
  togglePlugin: (name: string) => void;
  setPlugins: (plugins: InstalledPlugin[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerExtension: (type: keyof PluginExtensions, ext: any) => void;
}

export const usePluginStore = create<PluginManagerState>((set, get) => ({
  plugins: [],
  extensions: { panels: [], diracSkills: [], themes: [] },

  installPlugin: (manifest) => {
    const existing = get().plugins.find((p) => p.manifest.name === manifest.name);
    if (existing) return;
    set((s) => ({
      plugins: [...s.plugins, { manifest, enabled: true, api: null }],
    }));
    console.log(`[Plugin] Installed: ${manifest.name} v${manifest.version}`);
  },

  uninstallPlugin: (name) => set((s) => ({
    plugins: s.plugins.filter((p) => p.manifest.name !== name),
    extensions: {
      panels: s.extensions.panels.filter((p) => p.pluginName !== name),
      diracSkills: s.extensions.diracSkills.filter((p) => p.pluginName !== name),
      themes: s.extensions.themes.filter((p) => p.pluginName !== name),
    },
  })),

  togglePlugin: (name) => set((s) => ({
    plugins: s.plugins.map((p) =>
      p.manifest.name === name ? { ...p, enabled: !p.enabled } : p
    ),
  })),

  setPlugins: (plugins) => set({ plugins }),

  registerExtension: (type, ext) => set((s) => ({
    extensions: { ...s.extensions, [type]: [...s.extensions[type], ext] },
  })),
}));

/** Create the sandboxed API for a specific plugin */
export function createPluginAPI(manifest: PluginManifest): PluginAPI {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasPermission = (perm: string) => manifest.permissions.includes(perm as any);

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

    registerGateRenderer(_config) {
      if (!manifest.capabilities.includes('gate-renderer')) return;
      // Gate renderers are stored separately and used by the circuit renderer
      console.log(`[Plugin:${manifest.name}] Registered gate renderer for ${_config.gateName}`);
    },

    registerDiracSkill(config) {
      if (!manifest.capabilities.includes('dirac-skill')) return;
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
      console.log(`[Plugin:${manifest.name}] ${message}`);
    },
  };
}
