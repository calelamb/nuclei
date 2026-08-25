import { create } from 'zustand';
import { useProjectStore } from '../stores/projectStore';
import { parseQecStudyYaml, serializeQecStudy, type QecStudy } from '../types/qecStudy';
import {
  QecStudyFileExistsError,
  type QecStudyDirEntry,
  type QecStudyFs,
  type QecStudyManifestFile,
} from './qecStudyFs';

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
  projectRoot: string | null;
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
let activeProjectRoot: string | null = null;
const pendingCreates = new Set<string>();

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function studiesPath(projectRoot: string, fs: QecStudyFs): string {
  return fs.join(projectRoot, STUDIES_DIRECTORY);
}

function canonicalPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '');
  return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function includesStudiesChange(
  projectRoot: string,
  paths: readonly string[],
  fs: QecStudyFs,
): boolean {
  const directory = canonicalPath(studiesPath(projectRoot, fs));
  return paths.some((path) => {
    const candidate = canonicalPath(path);
    return candidate === directory || candidate.startsWith(`${directory}/`);
  });
}

async function assertProjectPath(
  projectRoot: string,
  candidate: string,
  fs: QecStudyFs,
): Promise<void> {
  const root = canonicalPath(await fs.resolvePath(projectRoot));
  const resolved = canonicalPath(await fs.resolvePath(candidate));
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new Error(`The Study path resolves outside the project: ${candidate}`);
  }
}

async function assertSafeStudiesDirectory(
  projectRoot: string,
  directory: string,
  fs: QecStudyFs,
): Promise<void> {
  await assertProjectPath(projectRoot, directory, fs);
  if (await fs.isSymlink(directory)) {
    throw new Error('The Studies folder cannot be a symbolic link.');
  }
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

interface DiscoveredEntryResult {
  study: DiscoveredQecStudy | null;
  validationError: QecStudyValidationError | null;
}

function entryError(fileName: string, message: string): DiscoveredEntryResult {
  return { study: null, validationError: { fileName, errors: [message] } };
}

async function discoverStudyEntry(
  projectRoot: string,
  directory: string,
  entry: QecStudyDirEntry,
  fs: QecStudyFs,
): Promise<DiscoveredEntryResult | null> {
  if (entry.isDirectory || !STUDY_SUFFIX.test(entry.name)) return null;
  const path = fs.join(directory, entry.name);
  try {
    await assertProjectPath(projectRoot, path, fs);
    if (entry.isSymlink || await fs.isSymlink(path)) {
      return entryError(entry.name, 'Study manifests cannot be symbolic links.');
    }
  } catch (error: unknown) {
    return entryError(entry.name, describeError(error));
  }
  let text: string;
  try {
    text = await fs.readTextFile(path);
  } catch (error: unknown) {
    return entryError(entry.name, `Could not read this Study: ${describeError(error)}`);
  }
  const parsed = parseQecStudyYaml(text);
  return parsed.ok
    ? { study: { fileName: entry.name, path, study: parsed.study }, validationError: null }
    : { study: null, validationError: { fileName: entry.name, errors: [...parsed.errors] } };
}

function quarantineDuplicateStudyIds(result: DiscoveryResult): DiscoveryResult {
  const duplicated = result.studies.filter((entry, index, studies) =>
    studies.some((candidate, candidateIndex) =>
      candidateIndex !== index && candidate.study.id === entry.study.id));
  const duplicateFiles = duplicated.map((entry) => entry.fileName);
  const duplicateErrors = duplicated.map((entry) => ({
    fileName: entry.fileName,
    errors: [`The duplicate Study id "${entry.study.id}" is also declared by another manifest.`],
  }));
  return {
    studies: result.studies
      .filter((entry) => !duplicateFiles.includes(entry.fileName))
      .sort((left, right) => left.fileName.localeCompare(right.fileName)),
    validationErrors: [...result.validationErrors, ...duplicateErrors]
      .sort((left, right) => left.fileName.localeCompare(right.fileName)),
  };
}

function parseSecureManifests(
  projectRoot: string,
  files: readonly QecStudyManifestFile[],
  fs: QecStudyFs,
): DiscoveryResult {
  const discovered = files.map((file): DiscoveredEntryResult => {
    if (file.error) return entryError(file.fileName, file.error);
    if (file.content === null) return entryError(file.fileName, 'Could not read this Study.');
    const parsed = parseQecStudyYaml(file.content);
    return parsed.ok
      ? {
        study: {
          fileName: file.fileName,
          path: fs.join(projectRoot, STUDIES_DIRECTORY, file.fileName),
          study: parsed.study,
        },
        validationError: null,
      }
      : { study: null, validationError: { fileName: file.fileName, errors: [...parsed.errors] } };
  });
  return quarantineDuplicateStudyIds({
    studies: discovered.flatMap((entry) => entry.study ? [entry.study] : []),
    validationErrors: discovered.flatMap((entry) =>
      entry.validationError ? [entry.validationError] : []),
  });
}

async function discoverStudies(projectRoot: string, fs: QecStudyFs): Promise<DiscoveryResult> {
  if (fs.readStudyManifests) {
    try {
      return parseSecureManifests(projectRoot, await fs.readStudyManifests(projectRoot), fs);
    } catch (error: unknown) {
      return discoveryFailure(describeError(error));
    }
  }
  const directory = studiesPath(projectRoot, fs);
  try {
    await assertSafeStudiesDirectory(projectRoot, directory, fs);
  } catch (error: unknown) {
    return discoveryFailure(describeError(error));
  }
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
  const discovered = (await Promise.all(entries.map((entry) =>
    discoverStudyEntry(projectRoot, directory, entry, fs)))).filter(
    (entry): entry is DiscoveredEntryResult => entry !== null,
  );
  return quarantineDuplicateStudyIds({
    studies: discovered.flatMap((entry) => entry.study ? [entry.study] : []),
    validationErrors: discovered.flatMap((entry) =>
      entry.validationError ? [entry.validationError] : []),
  });
}

function stopStudyWatcher(): void {
  watcherEpoch += 1;
  if (unwatch) {
    unwatch();
    unwatch = null;
  }
}

export const useQecStudyStore = create<QecStudyState>((set, get) => ({
  projectRoot: null,
  studies: [],
  validationErrors: [],
  loading: false,

  reload: async (projectRoot, fs) => {
    activeProjectRoot = projectRoot;
    const operation = ++latestOperation;
    set({ loading: true, projectRoot });
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
    if (activeProjectRoot === null) activeProjectRoot = projectRoot;
    if (get().projectRoot === null) set({ projectRoot });
    try {
      if (!fs.readStudyManifests) {
        await assertProjectPath(projectRoot, path, fs);
        await assertSafeStudiesDirectory(projectRoot, directory, fs);
        await fs.mkdir(directory, { recursive: true });
        await assertSafeStudiesDirectory(projectRoot, directory, fs);
      }
      await fs.createTextFileExclusive(projectRoot, fileName, content);
      if (activeProjectRoot === projectRoot) await get().reload(projectRoot, fs);
      return path;
    } catch (error: unknown) {
      if (error instanceof QecStudyFileExistsError) {
        throw new Error(`A Study named "${study.id}" already exists.`);
      }
      const message = describeError(error);
      if (message.startsWith('A Study named ')) throw new Error(message);
      throw new Error(`Could not create the Study "${study.name}": ${message}`);
    } finally {
      pendingCreates.delete(path);
    }
  },

  startWatching: async (projectRoot, fs) => {
    get().stopWatching();
    activeProjectRoot = projectRoot;
    latestOperation += 1;
    set({ loading: false, projectRoot });
    const epoch = ++watcherEpoch;
    let nextUnwatch: (() => void) | null = null;
    try {
      nextUnwatch = await fs.watch(
        projectRoot,
        (paths) => {
          if (epoch !== watcherEpoch) return;
          if (!includesStudiesChange(projectRoot, paths, fs)) return;
          void get().reload(projectRoot, fs);
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
    activeProjectRoot = null;
    latestOperation += 1;
    set({ projectRoot: null, loading: false, studies: [], validationErrors: [] });
  },
}));

useProjectStore.subscribe((current, previous) => {
  if (current.projectRoot === previous.projectRoot) return;
  const studyRoot = useQecStudyStore.getState().projectRoot;
  if (studyRoot !== null && studyRoot !== current.projectRoot) {
    useQecStudyStore.getState().clear();
  }
});

/** Convenience API for non-React callers. */
export function reloadStudies(projectRoot: string, fs: QecStudyFs): Promise<void> {
  return useQecStudyStore.getState().reload(projectRoot, fs);
}

/** Convenience API for non-React callers. */
export function createStudy(projectRoot: string, study: QecStudy, fs: QecStudyFs): Promise<string> {
  return useQecStudyStore.getState().create(projectRoot, study, fs);
}
