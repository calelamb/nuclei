import { create } from 'zustand';
import { parseQecStudyYaml, serializeQecStudy, type QecStudy } from '../types/qecStudy';
import type { QecStudyDirEntry, QecStudyFs } from './qecStudyFs';

const STUDIES_DIRECTORY = 'studies';
const STUDY_SUFFIX = /\.qec-study\.ya?ml$/i;

export interface DiscoveredQecStudy {
  fileName: string;
  path: string;
  study: QecStudy;
}

export interface QecStudyValidationError {
  fileName: string;
  errors: readonly string[];
}

export interface QecStudyState {
  studies: readonly DiscoveredQecStudy[];
  validationErrors: readonly QecStudyValidationError[];
  loading: boolean;
  reload(projectRoot: string, fs: QecStudyFs): Promise<void>;
  create(projectRoot: string, study: QecStudy, fs: QecStudyFs): Promise<string>;
  startWatching(projectRoot: string, fs: QecStudyFs): Promise<void>;
  stopWatching(): void;
  clear(): void;
}

interface DiscoveryResult {
  studies: DiscoveredQecStudy[];
  validationErrors: QecStudyValidationError[];
}

let latestOperation = 0;
let watcherEpoch = 0;
let unwatch: (() => void) | null = null;
const pendingCreates = new Set<string>();

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function studiesPath(projectRoot: string, fs: QecStudyFs): string {
  return fs.join(projectRoot, STUDIES_DIRECTORY);
}

function studyFileName(study: QecStudy): string {
  return `${study.id}.qec-study.yaml`;
}

function discoveryFailure(message: string): DiscoveryResult {
  return {
    studies: [],
    validationErrors: [{ fileName: STUDIES_DIRECTORY, errors: [message] }],
  };
}

function reportLifecycleError(
  set: (partial: Partial<QecStudyState> | ((state: QecStudyState) => Partial<QecStudyState>)) => void,
  message: string,
): void {
  set((state) => ({
    validationErrors: [
      ...state.validationErrors,
      { fileName: STUDIES_DIRECTORY, errors: [message] },
    ],
  }));
}

async function discoverStudies(projectRoot: string, fs: QecStudyFs): Promise<DiscoveryResult> {
  const directory = studiesPath(projectRoot, fs);
  let exists: boolean;
  try {
    exists = await fs.exists(directory);
  } catch (error: unknown) {
    return discoveryFailure(`Could not check the Studies folder: ${describeError(error)}`);
  }
  if (!exists) return { studies: [], validationErrors: [] };

  let entries: QecStudyDirEntry[];
  try {
    entries = await fs.readDir(directory);
  } catch (error: unknown) {
    return discoveryFailure(`Could not read the Studies folder: ${describeError(error)}`);
  }

  const result: DiscoveryResult = { studies: [], validationErrors: [] };
  for (const entry of entries) {
    if (entry.isDirectory || !STUDY_SUFFIX.test(entry.name)) continue;
    const path = fs.join(directory, entry.name);
    let text: string;
    try {
      text = await fs.readTextFile(path);
    } catch (error: unknown) {
      result.validationErrors.push({
        fileName: entry.name,
        errors: [`Could not read this Study: ${describeError(error)}`],
      });
      continue;
    }

    const parsed = parseQecStudyYaml(text);
    if (parsed.ok) result.studies.push({ fileName: entry.name, path, study: parsed.study });
    else result.validationErrors.push({ fileName: entry.name, errors: [...parsed.errors] });
  }

  result.studies.sort((left, right) => left.fileName.localeCompare(right.fileName));
  result.validationErrors.sort((left, right) => left.fileName.localeCompare(right.fileName));
  return result;
}

function stopStudyWatcher(): void {
  watcherEpoch += 1;
  if (unwatch) {
    unwatch();
    unwatch = null;
  }
}

export const useQecStudyStore = create<QecStudyState>((set, get) => ({
  studies: [],
  validationErrors: [],
  loading: false,

  reload: async (projectRoot, fs) => {
    const operation = ++latestOperation;
    set({ loading: true });
    const result = await discoverStudies(projectRoot, fs);
    if (operation !== latestOperation) return;
    set({ loading: false, studies: [...result.studies], validationErrors: [...result.validationErrors] });
  },

  create: async (projectRoot, study, fs) => {
    let content: string;
    try {
      content = serializeQecStudy(study);
    } catch (error: unknown) {
      throw new Error(`Could not create this Study: ${describeError(error)}`);
    }

    const directory = studiesPath(projectRoot, fs);
    const fileName = studyFileName(study);
    const path = fs.join(directory, fileName);
    if (pendingCreates.has(path)) {
      throw new Error(`A Study named "${study.id}" already exists.`);
    }
    pendingCreates.add(path);
    const operation = ++latestOperation;
    try {
      await fs.mkdir(directory, { recursive: true });
      if (await fs.exists(path)) {
        throw new Error(`A Study named "${study.id}" already exists.`);
      }
      await fs.writeTextFile(path, content);
      if (operation !== latestOperation) return path;
      set((state) => ({
        studies: [...state.studies, { fileName, path, study }].sort((left, right) =>
          left.fileName.localeCompare(right.fileName),
        ),
      }));
      return path;
    } catch (error: unknown) {
      const message = describeError(error);
      if (message.startsWith('A Study named ')) throw new Error(message);
      throw new Error(`Could not create the Study "${study.name}": ${message}`);
    } finally {
      pendingCreates.delete(path);
    }
  },

  startWatching: async (projectRoot, fs) => {
    get().stopWatching();
    latestOperation += 1;
    set({ loading: false });
    const epoch = ++watcherEpoch;
    const directory = studiesPath(projectRoot, fs);
    let directoryExists: boolean;
    try {
      directoryExists = await fs.exists(directory);
    } catch (error: unknown) {
      if (epoch === watcherEpoch) {
        reportLifecycleError(
          set,
          `Could not check the Studies folder for changes: ${describeError(error)}`,
        );
      }
      return;
    }
    if (!directoryExists || epoch !== watcherEpoch) return;

    let nextUnwatch: (() => void) | null = null;
    try {
      nextUnwatch = await fs.watch(
        directory,
        () => {
          if (epoch === watcherEpoch) void get().reload(projectRoot, fs);
        },
        { recursive: true },
      );
    } catch (error: unknown) {
      if (epoch === watcherEpoch) {
        reportLifecycleError(set, `Could not watch the Studies folder: ${describeError(error)}`);
      }
      return;
    }
    if (epoch !== watcherEpoch) {
      nextUnwatch();
      return;
    }
    unwatch = nextUnwatch;
  },

  stopWatching: stopStudyWatcher,

  clear: () => {
    get().stopWatching();
    latestOperation += 1;
    set({ loading: false, studies: [], validationErrors: [] });
  },
}));

/** Convenience API for non-React callers. */
export function reloadStudies(projectRoot: string, fs: QecStudyFs): Promise<void> {
  return useQecStudyStore.getState().reload(projectRoot, fs);
}

/** Convenience API for non-React callers. */
export function createStudy(projectRoot: string, study: QecStudy, fs: QecStudyFs): Promise<string> {
  return useQecStudyStore.getState().create(projectRoot, study, fs);
}
