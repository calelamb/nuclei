import { invoke } from '@tauri-apps/api/core';
import { mkdir, readDir, readTextFile, writeTextFile, exists, watch } from '@tauri-apps/plugin-fs';
import { sha256Hex } from '../lib/sha256';
import type { GitInfo } from '../types/experiment';
import type { ExperimentFs } from './experimentStore';
import type { RunnerFs } from './experimentRunner';

/**
 * PRD 09 Phase C — Tauri-backed adapters that bind the injectable
 * `ExperimentFs` / `RunnerFs` ports to `@tauri-apps/plugin-fs`. Kept in a
 * separate module (never imported by unit tests) so the store and runner stay
 * Tauri-free and node-testable. Paths are joined with '/', matching the
 * existing convention in `tauriBridge.listDirectory`.
 */

function joinPath(...parts: string[]): string {
  return parts
    .filter((p) => p.length > 0)
    .join('/')
    .replace(/\/{2,}/g, '/');
}

export function createTauriExperimentFs(): ExperimentFs {
  return {
    readTextFile: (path) => readTextFile(path),
    async readDir(path) {
      const entries = await readDir(path);
      return entries.map((e) => ({ name: e.name ?? '', isDirectory: e.isDirectory }));
    },
    exists: (path) => exists(path),
    join: joinPath,
    async watch(path, onEvent, options) {
      return watch(path, () => onEvent(), { recursive: options?.recursive ?? true });
    },
  };
}

export function createTauriRunnerFs(): RunnerFs {
  return {
    mkdir: (path, options) => mkdir(path, { recursive: options?.recursive ?? false }),
    writeFile: (path, content) => writeTextFile(path, content),
  };
}

export const runnerJoin = joinPath;
export const runnerHash = sha256Hex;

/**
 * Git commit/dirty for a project via the `git_project_info` Tauri command.
 * Returns null when the path isn't a repo or git is unavailable (the command
 * never errors — see `src-tauri/src/commands/git_info.rs`).
 */
export function tauriGitInfo(projectRoot: string): Promise<GitInfo | null> {
  return invoke<GitInfo | null>('git_project_info', { path: projectRoot }).catch(() => null);
}
