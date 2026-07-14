/**
 * Nuclei Plugin System — Type Definitions
 *
 * Plugins extend Nuclei with custom panels, gate renderers, Dirac skills, and
 * themes. A plugin is a single-file, dependency-free ES module that exports an
 * `activate(api)` function; Nuclei loads it from disk, hands it a `PluginAPI`,
 * and renders whatever it registers.
 *
 * SECURITY — Nuclei plugins are NOT sandboxed. A plugin's entry JS runs as
 * ordinary JavaScript in the Nuclei webview with full DOM/`window`/`fetch`
 * access and the same privileges as the app. The `permissions[]` list only
 * gates the friendly `api.getCircuit…`/`api.getEditor…` reads and is shown at load
 * for transparency — it is NOT enforcement, and a plugin can reach around the
 * API entirely. Plugins are LOCAL, user-authored, TRUSTED code, loaded only by
 * an explicit folder pick (or a path the user previously chose). There is no
 * remote registry. Nuclei protects itself from *broken* plugins (manifest
 * validation + per-plugin error isolation) but not from *malicious* ones. Real
 * isolation (Worker/iframe message passing) is future work.
 */

import type { CircuitSnapshot, SimulationResult } from '../types/quantum';

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  entry: string; // relative path to JS entry point
  capabilities: PluginCapability[];
  permissions: PluginPermission[];
}

export type PluginCapability =
  | 'custom-panel'
  | 'gate-renderer'
  | 'kernel-extension'
  | 'dirac-skill'
  | 'theme';

export type PluginPermission =
  | 'read-circuit'
  | 'read-results'
  | 'read-editor'
  | 'write-editor';

export interface PluginRegistration {
  manifest: PluginManifest;
  enabled: boolean;
  installedAt: string;
  source: string; // URL or local path
}

/**
 * Optional cleanup returned from `activate(api)` or from a panel's
 * `render(container)`. Called on plugin disable/uninstall (activate-level) or
 * panel unmount (render-level).
 */
export type PluginCleanup = () => void;

/**
 * The plugin entry contract. A plugin's entry module exports this as a named
 * `activate` export OR as its default export:
 *
 * ```js
 * export function activate(api) {
 *   api.registerPanel({ id: 'x', title: 'X', render(el) {  ...  } });
 *   return () => { ... };   // optional plugin-level cleanup
 * }
 * ```
 */
export type PluginActivate = (api: PluginAPI) => PluginCleanup | void;

/** The shape the loader expects back from a blob-imported entry module. */
export interface PluginModule {
  activate?: PluginActivate;
  default?: PluginActivate;
}

/** The API surface handed to a plugin's `activate(api)`. */
export interface PluginAPI {
  // Read-only state access. Returns null when the plugin lacks the matching
  // permission (`read-circuit` / `read-results` / `read-editor`).
  getCircuitSnapshot(): CircuitSnapshot | null;
  getSimulationResult(): SimulationResult | null;
  getEditorCode(): string;
  getFramework(): string;

  // Subscribe to state changes. The returned function unsubscribes.
  onCircuitChange(callback: (snapshot: CircuitSnapshot) => void): () => void;
  onResultChange(callback: (result: SimulationResult) => void): () => void;

  // Plugin registration
  registerPanel(config: {
    id: string;
    title: string;
    // May return a cleanup fn run on panel unmount.
    render: (container: HTMLElement) => PluginCleanup | void;
  }): void;
  registerGateRenderer(config: {
    gateName: string;
    render: (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => void;
  }): void;
  registerDiracSkill(config: { name: string; systemPromptFragment: string; tools?: unknown[] }): void;
  registerTheme(config: { name: string; colors: Record<string, string> }): void;

  // Utilities
  log(message: string): void;
}

/** Lifecycle status of an installed plugin, for the manager UI. */
export type PluginStatus = 'active' | 'disabled' | 'error';

export interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  api: PluginAPI | null;
  /** Absolute folder path the plugin was loaded from (persistence key). */
  source: string;
  status: PluginStatus;
  /** Populated when `status === 'error'` — the reason load/activate failed. */
  error?: string;
  /** Cleanup returned by `activate(api)`, run on disable/uninstall/reload. */
  cleanup?: PluginCleanup;
}
