import { describe, it, expect, beforeEach, vi } from 'vitest';
import { usePluginStore, selectEnabledPanels, selectEnabledThemes } from './pluginManager';
import type { InstalledPlugin, PluginManifest } from './types';

function manifest(name: string, over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name,
    version: '1.0.0',
    description: '',
    author: '',
    entry: 'entry.js',
    capabilities: ['custom-panel'],
    permissions: [],
    ...over,
  };
}

function installed(name: string, over: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    manifest: manifest(name),
    enabled: true,
    api: null,
    source: `/plugins/${name}`,
    status: 'active',
    ...over,
  };
}

function reset() {
  usePluginStore.setState({ plugins: [], extensions: { panels: [], diracSkills: [], themes: [] } });
}

describe('pluginManager store', () => {
  beforeEach(reset);

  it('installs a fully-formed plugin and dedupes by name', () => {
    const s = usePluginStore.getState();
    s.installPlugin(installed('a'));
    s.installPlugin(installed('a')); // dup ignored
    expect(usePluginStore.getState().plugins).toHaveLength(1);
    expect(usePluginStore.getState().plugins[0].source).toBe('/plugins/a');
  });

  it('supports the legacy (manifest, source) install signature', () => {
    usePluginStore.getState().installPlugin(manifest('legacy'), '/somewhere');
    const p = usePluginStore.getState().plugins[0];
    expect(p.manifest.name).toBe('legacy');
    expect(p.source).toBe('/somewhere');
    expect(p.api).toBeNull();
  });

  it('runs cleanup and prunes extensions on disable', () => {
    const cleanup = vi.fn();
    usePluginStore.getState().installPlugin(installed('a', { cleanup }));
    usePluginStore.getState().registerExtension('panels', {
      pluginName: 'a',
      id: 'p',
      title: 'P',
      render: () => {},
    });
    expect(usePluginStore.getState().extensions.panels).toHaveLength(1);

    usePluginStore.getState().disablePlugin('a');

    expect(cleanup).toHaveBeenCalledOnce();
    const st = usePluginStore.getState();
    expect(st.extensions.panels).toHaveLength(0);
    expect(st.plugins[0].enabled).toBe(false);
    expect(st.plugins[0].status).toBe('disabled');
    expect(st.plugins[0].api).toBeNull();
    expect(st.plugins[0].cleanup).toBeUndefined();
  });

  it('runs cleanup and prunes extensions on uninstall', () => {
    const cleanup = vi.fn();
    usePluginStore.getState().installPlugin(installed('a', { cleanup }));
    usePluginStore.getState().registerExtension('themes', {
      pluginName: 'a',
      name: 'Ocean',
      colors: {},
    });
    usePluginStore.getState().uninstallPlugin('a');
    expect(cleanup).toHaveBeenCalledOnce();
    const st = usePluginStore.getState();
    expect(st.plugins).toHaveLength(0);
    expect(st.extensions.themes).toHaveLength(0);
  });

  it('a throwing cleanup does not block disable', () => {
    const cleanup = vi.fn(() => {
      throw new Error('boom');
    });
    usePluginStore.getState().installPlugin(installed('a', { cleanup }));
    expect(() => usePluginStore.getState().disablePlugin('a')).not.toThrow();
    expect(usePluginStore.getState().plugins[0].enabled).toBe(false);
  });

  it('togglePlugin disables an enabled plugin and re-enables the flag', () => {
    usePluginStore.getState().installPlugin(installed('a'));
    usePluginStore.getState().togglePlugin('a');
    expect(usePluginStore.getState().plugins[0].enabled).toBe(false);
    usePluginStore.getState().togglePlugin('a');
    expect(usePluginStore.getState().plugins[0].enabled).toBe(true);
  });

  it('replacePlugin swaps a record by name without duplicating', () => {
    usePluginStore.getState().installPlugin(installed('a'));
    usePluginStore.getState().replacePlugin(installed('a', { status: 'error', error: 'x' }));
    const st = usePluginStore.getState();
    expect(st.plugins).toHaveLength(1);
    expect(st.plugins[0].status).toBe('error');
  });

  it('selectors only return extensions of enabled plugins', () => {
    const s = usePluginStore.getState();
    s.installPlugin(installed('a'));
    s.installPlugin(installed('b', { enabled: false, status: 'disabled' }));
    s.registerExtension('panels', { pluginName: 'a', id: 'pa', title: 'A', render: () => {} });
    s.registerExtension('panels', { pluginName: 'b', id: 'pb', title: 'B', render: () => {} });
    s.registerExtension('themes', { pluginName: 'a', name: 'TA', colors: {} });

    const st = usePluginStore.getState();
    expect(selectEnabledPanels(st).map((p) => p.pluginName)).toEqual(['a']);
    expect(selectEnabledThemes(st).map((t) => t.pluginName)).toEqual(['a']);
  });
});
