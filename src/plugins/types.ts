/**
 * Nuclei Plugin System — Type Definitions
 *
 * Plugins extend Nuclei with custom panels, gate renderers, Dirac skills, and themes.
 * All plugins are sandboxed and can only access the API surface defined here.
 */

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

/** The API surface exposed to plugins in their sandbox */
export interface PluginAPI {
  // Read-only state access
  getCircuitSnapshot(): unknown | null;
  getSimulationResult(): unknown | null;
  getEditorCode(): string;
  getFramework(): string;

  // Subscribe to state changes
  onCircuitChange(callback: (snapshot: unknown) => void): () => void;
  onResultChange(callback: (result: unknown) => void): () => void;

  // Plugin registration
  registerPanel(config: { id: string; title: string; render: (container: HTMLElement) => void }): void;
  registerGateRenderer(config: { gateName: string; render: (ctx: CanvasRenderingContext2D, x: number, y: number, size: number) => void }): void;
  registerDiracSkill(config: { name: string; systemPromptFragment: string; tools?: unknown[] }): void;
  registerTheme(config: { name: string; colors: Record<string, string> }): void;

  // Utilities
  log(message: string): void;
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  api: PluginAPI | null;
}
