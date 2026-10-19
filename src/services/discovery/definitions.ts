/** Scan a project for `experiments/*.discovery.yaml` and their runs. */

import { parseDiscoveryYaml, type DiscoverySpec, type RunRecord } from '../../types/discovery';
import { listRuns, type DiscoveryFs, type JoinFn } from './records';

export interface DiscoveryDefinition {
  /** File name, e.g. `w-state-synthesis.discovery.yaml`. */
  fileName: string;
  /** Project-root-joined path to the YAML file. */
  path: string;
  spec: DiscoverySpec;
}

export interface DiscoveryValidationError {
  fileName: string;
  path: string;
  errors: string[];
}

const DEFINITION_FILE = /\.discovery\.ya?ml$/i;

/** Malformed files come back as data, never as a thrown error. */
export async function scanDefinitions(
  fs: DiscoveryFs,
  join: JoinFn,
  projectRoot: string,
): Promise<{ definitions: DiscoveryDefinition[]; validationErrors: DiscoveryValidationError[] }> {
  const dir = join(projectRoot, 'experiments');
  const out = { definitions: [] as DiscoveryDefinition[], validationErrors: [] as DiscoveryValidationError[] };
  if (!(await fs.exists(dir))) return out;
  let entries: Array<{ name: string; isDirectory: boolean }>;
  try {
    entries = await fs.readDir(dir);
  } catch (e) {
    out.validationErrors.push({ fileName: 'experiments', path: dir, errors: [`could not list experiments/: ${e instanceof Error ? e.message : String(e)}`] });
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory || !DEFINITION_FILE.test(entry.name)) continue;
    const path = join(dir, entry.name);
    const text = await fs.readFile(path).catch(() => null);
    if (text === null) {
      out.validationErrors.push({ fileName: entry.name, path, errors: ['could not read file'] });
      continue;
    }
    const parsed = parseDiscoveryYaml(text, entry.name);
    if (parsed.ok) out.definitions.push({ fileName: entry.name, path, spec: parsed.spec });
    else out.validationErrors.push({ fileName: entry.name, path, errors: parsed.errors });
  }
  out.definitions.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return out;
}

export async function scanAllRuns(
  fs: DiscoveryFs,
  join: JoinFn,
  projectRoot: string,
  definitions: readonly DiscoveryDefinition[],
): Promise<Record<string, RunRecord[]>> {
  const entries = await Promise.all(
    definitions.map(async (d) => [d.fileName, await listRuns(fs, join, projectRoot, d.fileName).catch(() => [])] as const),
  );
  return Object.fromEntries(entries);
}
