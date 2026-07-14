import { invoke } from '@tauri-apps/api/core';
import type { FrameworkInfo, FrameworkStatus } from '../stores/frameworksStore';

/**
 * Typed front-end for the Rust environment commands
 * (`src-tauri/src/commands/frameworks.rs`). Every call is a Tauri IPC
 * round-trip, so this module is desktop-only; `isDesktop()` gates each call
 * and the callers render a "desktop only" note on web rather than throwing.
 */

/** `python_setup` — the "no Python / too-old Python" situation + how to fix it. */
export interface PythonSetup {
  found: boolean;
  version: string | null;
  path: string | null;
  supported: boolean;
  too_old: boolean;
  min_version: string;
  os: 'macos' | 'windows' | 'linux';
  package_manager: string | null;
  install_command: string | null;
  download_url: string;
}

/** `environment_report` — one-call diagnostics for the Environment panel. */
export interface EnvironmentReport {
  os: string;
  system_python_version: string | null;
  system_python_path: string | null;
  python_supported: boolean;
  venv_path: string;
  venv_exists: boolean;
  venv_python_version: string | null;
  kernel_core_deps_ok: boolean;
  installed_frameworks: string[];
  healthy: boolean;
}

export function isDesktop(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

export function getEnvironmentReport(): Promise<EnvironmentReport> {
  return invoke<EnvironmentReport>('environment_report');
}

export function getPythonSetup(): Promise<PythonSetup> {
  return invoke<PythonSetup>('python_setup');
}

/** Install a modern Python via the OS package manager; resolves to the new
 * version string, rejects with a human-readable message otherwise. */
export function installPython(): Promise<string> {
  return invoke<string>('python_install');
}

export function getFrameworkStatus(): Promise<FrameworkStatus> {
  return invoke<FrameworkStatus>('framework_status');
}

/** Map a kernel `missing_dependency` name to its installable catalog entry. */
export function resolveFramework(name: string): Promise<FrameworkInfo | null> {
  return invoke<FrameworkInfo | null>('framework_resolve', { name });
}

/** Install frameworks by catalog id; resolves to the list of failures (empty on success). */
export function installFrameworks(ids: string[]): Promise<string[]> {
  return invoke<string[]>('framework_install', { frameworks: ids });
}

/** Remove frameworks by catalog id; resolves to the list of failures. */
export function uninstallFrameworks(ids: string[]): Promise<string[]> {
  return invoke<string[]>('framework_uninstall', { frameworks: ids });
}

/** Rebuild the managed venv (preserving installed frameworks); resolves to the new Python version. */
export function repairVenv(): Promise<string> {
  return invoke<string>('venv_repair');
}
