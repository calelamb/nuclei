/**
 * On-disk layout and persistence for a discovery run (PRD 14 §7.4):
 *
 *   experiments/<name>.discovery.yaml
 *   experiments/<name>/discovery/<runId>/run.json
 *   experiments/<name>/discovery/<runId>/candidates/<candidateId>.json
 *   experiments/<name>/discovery/<runId>/champion.py
 *
 * All I/O goes through the injected `DiscoveryFs` (PlatformBridge-style), so
 * the runner works on desktop, web and the e2e fixture bridge.
 */

import { discoveryBaseName, type CandidateRecord, type ExploitRecord, type RunRecord } from '../../types/discovery';

export interface DiscoveryFs {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  /** Resolves null when the file does not exist. */
  readFile(path: string): Promise<string | null>;
  readDir(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>;
  exists(path: string): Promise<boolean>;
}

export type JoinFn = (...parts: string[]) => string;

export interface RunPaths {
  runDir: string;
  runJson: string;
  candidatesDir: string;
  championPy: string;
  /** Red Queen exploits (addendum §F): `<runDir>/exploits/<candidateId>.json`. */
  exploitsDir: string;
  candidateFile(id: string): string;
  exploitFile(id: string): string;
}

/** `experiments/<name>/discovery` for a definition file. */
export function discoveryRunsDir(join: JoinFn, projectRoot: string, definitionFile: string): string {
  return join(projectRoot, 'experiments', discoveryBaseName(definitionFile), 'discovery');
}

export function runPaths(join: JoinFn, projectRoot: string, definitionFile: string, runId: string): RunPaths {
  const runDir = join(discoveryRunsDir(join, projectRoot, definitionFile), runId);
  const candidatesDir = join(runDir, 'candidates');
  return {
    runDir,
    runJson: join(runDir, 'run.json'),
    candidatesDir,
    championPy: join(runDir, 'champion.py'),
    exploitsDir: join(runDir, 'exploits'),
    candidateFile: (id) => join(candidatesDir, `${id}.json`),
    exploitFile: (id) => join(runDir, 'exploits', `${id}.json`),
  };
}

export function timestampSlug(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

export function makeRunId(date: Date, entropy: number): string {
  return `${timestampSlug(date)}-${(entropy & 0xffff).toString(16).padStart(4, '0')}`;
}

export function candidateIdFor(index: number): string {
  return `c-${String(index).padStart(4, '0')}`;
}

export const toJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Serialized writer: writes run in order, errors are reported (never
 * swallowed) through `onError`, and `flush()` waits for everything queued.
 */
export function createPersister(fs: DiscoveryFs, paths: RunPaths, onError: (message: string) => void) {
  let tail: Promise<void> = Promise.resolve();
  let ready: Promise<void> | null = null;

  let exploitsReady: Promise<void> | null = null;

  const enqueue = (path: string, content: string, dir?: 'exploits') => {
    tail = tail.then(async () => {
      try {
        ready ??= fs.mkdir(paths.candidatesDir, { recursive: true });
        await ready;
        if (dir === 'exploits') {
          exploitsReady ??= fs.mkdir(paths.exploitsDir, { recursive: true });
          await exploitsReady;
        }
        await fs.writeFile(path, content);
      } catch (e) {
        ready = null;
        exploitsReady = null;
        onError(`Could not write ${path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  };

  return {
    writeRun: (run: RunRecord) => enqueue(paths.runJson, toJson(run)),
    writeCandidate: (c: CandidateRecord) => enqueue(paths.candidateFile(c.id), toJson(c)),
    writeChampion: (program: string) => enqueue(paths.championPy, program),
    writeExploit: (id: string, record: ExploitRecord) => enqueue(paths.exploitFile(id), toJson(record), 'exploits'),
    flush: () => tail,
  };
}

export type Persister = ReturnType<typeof createPersister>;

export function isRunRecord(value: unknown): value is RunRecord {
  const v = value as Partial<RunRecord> | null;
  return !!v && v.schema === 1 && typeof v.run_id === 'string' && !!v.spec && !!v.archive && Array.isArray(v.rng);
}

export function isCandidateRecord(value: unknown): value is CandidateRecord {
  const v = value as Partial<CandidateRecord> | null;
  return !!v && typeof v.id === 'string' && typeof v.program === 'string' && typeof v.island === 'number';
}

export async function loadRunRecord(fs: DiscoveryFs, paths: RunPaths): Promise<RunRecord | null> {
  const text = await fs.readFile(paths.runJson);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRunRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** All readable candidate files, in id order; unreadable files are returned as warnings. */
export async function loadCandidates(
  fs: DiscoveryFs,
  paths: RunPaths,
): Promise<{ candidates: CandidateRecord[]; warnings: string[] }> {
  const warnings: string[] = [];
  if (!(await fs.exists(paths.candidatesDir))) return { candidates: [], warnings };
  const entries = await fs.readDir(paths.candidatesDir);
  const candidates: CandidateRecord[] = [];
  for (const entry of entries) {
    if (entry.isDirectory || !entry.name.endsWith('.json')) continue;
    const text = await fs.readFile(paths.candidatesDir.replace(/\/$/, '') + '/' + entry.name);
    try {
      const parsed: unknown = text === null ? null : JSON.parse(text);
      if (isCandidateRecord(parsed)) candidates.push(parsed);
      else warnings.push(`Skipped unreadable candidate file ${entry.name}`);
    } catch {
      warnings.push(`Skipped corrupt candidate file ${entry.name}`);
    }
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id));
  return { candidates, warnings };
}

/** Scan `experiments/<name>/discovery/*` for run.json files (newest run first). */
export async function listRuns(
  fs: DiscoveryFs,
  join: JoinFn,
  projectRoot: string,
  definitionFile: string,
): Promise<RunRecord[]> {
  const dir = discoveryRunsDir(join, projectRoot, definitionFile);
  if (!(await fs.exists(dir))) return [];
  const runs: RunRecord[] = [];
  for (const entry of await fs.readDir(dir)) {
    if (!entry.isDirectory) continue;
    const run = await loadRunRecord(fs, runPaths(join, projectRoot, definitionFile, entry.name));
    if (run) runs.push(run.status === 'running' ? { ...run, status: 'stale' } : run);
  }
  return runs.sort((a, b) => b.run_id.localeCompare(a.run_id));
}
