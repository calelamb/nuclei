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

function directoryEntries(project: FixtureProject, root: string, relative: string): DirEntry[] | null {
  if (relative && Object.hasOwn(project.files, relative)) return null;
  const prefix = relative ? `${relative}/` : '';
  const children = new Map<string, DirEntry>();
  for (const filePath of Object.keys(project.files)) {
    if (!filePath.startsWith(prefix)) continue;
    const remainder = filePath.slice(prefix.length);
    const [name, ...rest] = remainder.split('/');
    if (!name) continue;
    const path = `${root}/${prefix}${name}`;
    children.set(name, { name, path, kind: rest.length > 0 ? 'directory' : 'file' });
  }
  return [...children.values()].sort((left, right) => left.name.localeCompare(right.name));
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

/** Build the development-only, read-only bridge used by Playwright fixtures. */
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

  return {
    ...base,
    async getStoredValue<T>(key: string): Promise<T | null> {
      const fixtureValue = fixtureStoredValue<T>(key, root);
      return fixtureValue === undefined ? base.getStoredValue<T>(key) : fixtureValue;
    },
    async readFile(path: string): Promise<string | null> {
      const relative = fixtureRelativePath(path, root);
      return relative === null ? null : project.files[relative] ?? null;
    },
    async listDirectory(path: string): Promise<DirEntry[] | null> {
      const relative = fixtureRelativePath(path, root);
      return relative === null ? null : directoryEntries(project, root, relative);
    },
    async createFile(): Promise<null> { return null; },
    async createDirectory(): Promise<null> { return null; },
    async deleteFile(): Promise<false> { return false; },
  };
}
