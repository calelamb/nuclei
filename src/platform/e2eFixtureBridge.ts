import circuitSource from '../../tests/e2e/fixtures/qec-project/circuits/repetition.stim?raw';
import studySource from '../../tests/e2e/fixtures/qec-project/studies/surface-memory.qec-study.yaml?raw';
import { useResearchTourStore } from '../stores/researchTourStore';
import type { DirEntry, PlatformBridge } from './bridge';

const FIXTURE_BASE = 'tests/e2e/fixtures';
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

interface FixtureProject {
  readonly files: Readonly<Record<string, string>>;
}

const FIXTURE_PROJECTS: Readonly<Record<string, FixtureProject>> = Object.freeze({
  'qec-project': Object.freeze({
    files: Object.freeze({
      'circuits/repetition.stim': circuitSource,
      'studies/surface-memory.qec-study.yaml': studySource,
    }),
  }),
});

function fixtureRoot(projectId: string): string {
  return `${FIXTURE_BASE}/${projectId}`;
}

function fixtureRelativePath(path: string, root: string): string | null {
  if (path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:/.test(path)) return null;
  const segments = path.split(/[\\/]/);
  if (segments.includes('..') || segments.includes('.')) return null;
  if (path === root) return '';
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

function parentDirectory(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function directoryAncestors(path: string): readonly string[] {
  const parent = parentDirectory(path);
  return parent ? [parent, ...directoryAncestors(parent)] : [];
}

function seededDirectories(files: Readonly<Record<string, string>>): readonly string[] {
  return [...new Set(['', ...Object.keys(files).flatMap(directoryAncestors)])];
}

function directoryEntries(
  files: Readonly<Record<string, string>>,
  directories: readonly string[],
  root: string,
  relative: string,
): DirEntry[] | null {
  if (relative && (Object.hasOwn(files, relative) || !directories.includes(relative))) return null;
  const prefix = relative ? `${relative}/` : '';
  const paths = [...Object.keys(files), ...directories.filter(Boolean)];
  const children = paths.flatMap((childPath): DirEntry[] => {
    if (!childPath.startsWith(prefix) || childPath === relative) return [];
    const [name, ...rest] = childPath.slice(prefix.length).split('/');
    if (!name) return [];
    const directDirectory = directories.includes(`${prefix}${name}`);
    return [{
      name,
      path: `${root}/${prefix}${name}`,
      kind: rest.length > 0 || directDirectory ? 'directory' : 'file',
    }];
  });
  return children
    .filter((entry, index) => children.findIndex(({ name }) => name === entry.name) === index)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function missingDirectories(path: string, directories: readonly string[]): readonly string[] {
  if (!path || directories.includes(path)) return [];
  return [path, ...missingDirectories(parentDirectory(path), directories)];
}

function seedFixtureSession(root: string, workspace: string | null): void {
  localStorage.setItem('nuclei:research_tour_seen', '1');
  useResearchTourStore.setState({ seen: true, active: false, step: 0 });
  if (workspace !== 'research') return;
  localStorage.setItem('nuclei:workspace_mode_by_project', JSON.stringify({ [root]: 'research' }));
}

function fixtureStoredValue<T>(key: string, root: string): T | null | undefined {
  const values: Readonly<Record<string, unknown>> = {
    onboarding_complete: true,
    project_root: root,
    theme: 'light',
    [`project_tabs:${root}`]: [],
  };
  return Object.hasOwn(values, key) ? values[key] as T : undefined;
}

class FixtureSession {
  private readonly root: string;
  private files: Readonly<Record<string, string>>;
  private directories: readonly string[];
  private storedValues: Readonly<Record<string, unknown>> = {};

  constructor(root: string, project: FixtureProject) {
    this.root = root;
    this.files = { ...project.files };
    this.directories = seededDirectories(this.files);
  }

  async getStoredValue<T>(key: string): Promise<T | null> {
    if (Object.hasOwn(this.storedValues, key)) return this.storedValues[key] as T;
    const fixtureValue = fixtureStoredValue<T>(key, this.root);
    return fixtureValue === undefined ? null : fixtureValue;
  }

  async setStoredValue(key: string, value: unknown): Promise<void> {
    this.storedValues = Object.freeze({ ...this.storedValues, [key]: value });
  }

  async readFile(path: string): Promise<string | null> {
    const relative = fixtureRelativePath(path, this.root);
    return relative === null ? null : this.files[relative] ?? null;
  }

  async listDirectory(path: string): Promise<DirEntry[] | null> {
    const relative = fixtureRelativePath(path, this.root);
    return relative === null
      ? null
      : directoryEntries(this.files, this.directories, this.root, relative);
  }

  async createExclusive(path: string, content: string): Promise<'created' | 'exists' | null> {
    const relative = fixtureRelativePath(path, this.root);
    if (!relative || !this.directories.includes(parentDirectory(relative))) return null;
    if (Object.hasOwn(this.files, relative) || this.directories.includes(relative)) return 'exists';
    this.files = Object.freeze({ ...this.files, [relative]: content });
    return 'created';
  }

  async createDirectory(path: string, recursive = false): Promise<{ path: string } | null> {
    const relative = fixtureRelativePath(path, this.root);
    if (!relative || this.directories.includes(relative) || Object.hasOwn(this.files, relative)) {
      return null;
    }
    const parent = parentDirectory(relative);
    if (!recursive && !this.directories.includes(parent)) return null;
    const additions = missingDirectories(relative, this.directories);
    const current = parentDirectory(additions.at(-1) ?? '');
    if (current !== '' && !this.directories.includes(current)) return null;
    this.directories = Object.freeze([...new Set([...this.directories, ...additions])]);
    return { path };
  }

  async deleteFile(path: string): Promise<boolean> {
    const relative = fixtureRelativePath(path, this.root);
    if (!relative || !Object.hasOwn(this.files, relative)) return false;
    this.files = Object.freeze(Object.fromEntries(
      Object.entries(this.files).filter(([filePath]) => filePath !== relative),
    ));
    return true;
  }

  bridge(base: PlatformBridge): PlatformBridge {
    return {
      ...base,
      getStoredValue: <T>(key: string) => this.getStoredValue<T>(key),
      setStoredValue: (key, value) => this.setStoredValue(key, value),
      readFile: (path) => this.readFile(path),
      listDirectory: (path) => this.listDirectory(path),
      createFile: async (path, content) =>
        await this.createExclusive(path, content) === 'created' ? { path } : null,
      createFileExclusive: (path, content) => this.createExclusive(path, content),
      createDirectory: (path, recursive) => this.createDirectory(path, recursive),
      deleteFile: (path) => this.deleteFile(path),
    };
  }
}

/** Build the development-only, isolated mutable bridge used by Playwright fixtures. */
export function createE2eFixtureBridge(
  base: PlatformBridge,
  query: URLSearchParams,
): PlatformBridge | null {
  const projectId = query.get('e2eProject');
  if (!projectId || !PROJECT_ID_PATTERN.test(projectId)) return null;
  const project = FIXTURE_PROJECTS[projectId];
  if (!project) return null;
  const root = fixtureRoot(projectId);
  seedFixtureSession(root, query.get('workspace'));
  return new FixtureSession(root, project).bridge(base);
}
