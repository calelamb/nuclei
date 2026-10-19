// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QecStudyFileExistsError, type QecStudyFs } from '../../../services/qecStudyFs';
import { useQecStudyStore } from '../../../services/qecStudyStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import { useProjectStore } from '../../../stores/projectStore';
import { parseQecStudyYaml } from '../../../types/qecStudy';
import { QecStudySidebar } from './QecStudySidebar';

interface MemoryStudyFs extends QecStudyFs {
  files: Map<string, string>;
  createTextFileExclusive: ReturnType<typeof vi.fn<QecStudyFs['createTextFileExclusive']>>;
  watch: ReturnType<typeof vi.fn<QecStudyFs['watch']>>;
}

function studyYaml(id: string): string {
  return `schema: 1\nid: ${id}\nname: ${id.toUpperCase()} Study\nquestion: What about ${id}?\npreset: analyze\nsources: []\n`;
}

function memoryStudyFs(initialFiles: Record<string, string> = {}): MemoryStudyFs {
  const files = new Map(Object.entries(initialFiles));
  const join = (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/');
  return {
    files,
    join,
    resolvePath: vi.fn(async (...parts: string[]) => join(...parts)),
    isSymlink: vi.fn(async () => false),
    exists: vi.fn(async (path: string) =>
      files.has(path) || [...files.keys()].some((file) => file.startsWith(`${path}/`))),
    mkdir: vi.fn(async () => undefined),
    readTextFile: vi.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    }),
    readDir: vi.fn(async (path: string) => {
      const prefix = `${path}/`;
      return [...files.keys()]
        .filter((file) => file.startsWith(prefix))
        .map((file) => ({ name: file.slice(prefix.length), isDirectory: false, isSymlink: false }));
    }),
    createTextFileExclusive: vi.fn(async (
      projectRoot: string,
      fileName: string,
      content: string,
    ) => {
      const path = join(projectRoot, 'studies', fileName);
      if (files.has(path)) throw new QecStudyFileExistsError(path);
      files.set(path, content);
    }),
    watch: vi.fn(async () => () => undefined),
  };
}

function resetStores(): void {
  useQecStudyStore.getState().clear();
  useQecStudyStore.setState({ studies: [], validationErrors: [], loading: false });
  useQecStudyUiStore.setState({ activeStudyId: null });
  useProjectStore.setState({ projectRoot: null, tabs: [], activeTabPath: null });
}

describe('<QecStudySidebar />', () => {
  afterEach(() => {
    cleanup();
    resetStores();
  });

  it('reloads the project Studies and exposes validation details', async () => {
    const fs = memoryStudyFs({
      '/project/studies/surface.qec-study.yaml': 'schema: 1\nid: surface\nname: Surface memory\nquestion: How low?\npreset: analyze\nsources: []\n',
      '/project/studies/broken.qec-study.yaml': 'schema: nope',
    });
    useProjectStore.setState({ projectRoot: '/project' });

    const view = render(<QecStudySidebar fs={fs} />);

    expect(await view.findByRole('button', { name: /Surface memory/ })).toBeTruthy();
    expect(view.getByText('broken.qec-study.yaml')).toBeTruthy();
    expect(view.getByText(/schema:/)).toBeTruthy();
  });

  it('keeps the creation form closed until asked for, and closes it again after creating (qec-r-23)', async () => {
    const fs = memoryStudyFs();
    useProjectStore.setState({ projectRoot: '/project' });
    const view = render(<QecStudySidebar fs={fs} />);
    await waitFor(() => expect(useQecStudyStore.getState().loading).toBe(false));
    expect(view.queryByLabelText('Study name')).toBeNull();

    fireEvent.click(view.getByRole('button', { name: 'New study' }));
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    expect(view.queryByLabelText('Study name')).toBeNull();

    fireEvent.click(view.getByRole('button', { name: 'New study' }));
    fireEvent.change(view.getByLabelText('Study name'), { target: { value: 'Quick' } });
    fireEvent.change(view.getByLabelText('Research question'), { target: { value: 'Fast?' } });
    fireEvent.click(view.getByRole('button', { name: 'Create study' }));
    await waitFor(() => expect(view.queryByLabelText('Study name')).toBeNull());
  });

  it('returns focus to New study on Cancel and on Escape (qec-r-83)', async () => {
    const fs = memoryStudyFs();
    useProjectStore.setState({ projectRoot: '/project' });
    const view = render(<QecStudySidebar fs={fs} />);
    await waitFor(() => expect(useQecStudyStore.getState().loading).toBe(false));

    fireEvent.click(view.getByRole('button', { name: 'New study' }));
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'New study' }));

    fireEvent.click(view.getByRole('button', { name: 'New study' }));
    fireEvent.keyDown(view.getByLabelText('Study name'), { key: 'Escape' });
    expect(view.queryByLabelText('Study name')).toBeNull();
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'New study' }));
  });

  it('focuses the new study row and announces it after Create (qec-r-83)', async () => {
    const fs = memoryStudyFs();
    useProjectStore.setState({ projectRoot: '/project' });
    const view = render(<QecStudySidebar fs={fs} />);
    await waitFor(() => expect(useQecStudyStore.getState().loading).toBe(false));
    fireEvent.click(view.getByRole('button', { name: 'New study' }));
    fireEvent.change(view.getByLabelText('Study name'), { target: { value: 'Quick' } });
    fireEvent.change(view.getByLabelText('Research question'), { target: { value: 'Fast?' } });
    fireEvent.click(view.getByRole('button', { name: 'Create study' }));
    await waitFor(() => expect(view.queryByLabelText('Study name')).toBeNull());
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-pressed')).toBe('true'));
    expect(view.getByRole('status').textContent).toContain('Study created');
  });

  it('creates a validated minimal Study and selects it', async () => {
    const fs = memoryStudyFs();
    useProjectStore.setState({ projectRoot: '/project' });
    const view = render(<QecStudySidebar fs={fs} />);
    await waitFor(() => expect(useQecStudyStore.getState().loading).toBe(false));

    fireEvent.click(view.getByRole('button', { name: 'New study' }));
    fireEvent.change(view.getByLabelText('Study name'), { target: { value: 'Surface Memory' } });
    fireEvent.change(view.getByLabelText('Research question'), { target: { value: 'Does d=7 suppress errors?' } });
    fireEvent.change(view.getByLabelText('Starting preset'), { target: { value: 'observe' } });
    fireEvent.click(view.getByRole('button', { name: 'Create study' }));

    await waitFor(() => expect(useQecStudyUiStore.getState().activeStudyId).toBe('surface-memory'));
    const written = fs.files.get('/project/studies/surface-memory.qec-study.yaml');
    expect(written).toBeDefined();
    expect(parseQecStudyYaml(written ?? '')).toMatchObject({
      ok: true,
      study: { id: 'surface-memory', name: 'Surface Memory', preset: 'observe', sources: [] },
    });
  });

  it('validates form input before touching the filesystem', async () => {
    const fs = memoryStudyFs();
    useProjectStore.setState({ projectRoot: '/project' });
    const view = render(<QecStudySidebar fs={fs} />);
    await waitFor(() => expect(useQecStudyStore.getState().loading).toBe(false));

    fireEvent.click(view.getByRole('button', { name: 'New study' }));
    fireEvent.click(view.getByRole('button', { name: 'Create study' }));

    expect(view.getByRole('alert').textContent).toContain('Enter a name for the study');
    expect(fs.createTextFileExclusive).not.toHaveBeenCalled();
  });

  it('does not overwrite and shows an actionable create error', async () => {
    const original = 'schema: 1\nid: existing\nname: Existing\nquestion: Original?\npreset: build\nsources: []\n';
    const fs = memoryStudyFs({ '/project/studies/existing.qec-study.yaml': original });
    useProjectStore.setState({ projectRoot: '/project' });
    const view = render(<QecStudySidebar fs={fs} />);
    await view.findByRole('button', { name: /Existing/ });

    fireEvent.click(view.getByRole('button', { name: 'New study' }));
    fireEvent.change(view.getByLabelText('Study name'), { target: { value: 'Existing' } });
    fireEvent.change(view.getByLabelText('Research question'), { target: { value: 'Replace it?' } });
    fireEvent.click(view.getByRole('button', { name: 'Create study' }));

    expect(await view.findByText('A Study named "existing" already exists.')).toBeTruthy();
    expect(fs.files.get('/project/studies/existing.qec-study.yaml')).toBe(original);
  });

  it('disables the form while creation is pending', async () => {
    let finishWrite: (() => void) | undefined;
    const fs = memoryStudyFs();
    fs.createTextFileExclusive.mockImplementation(async (projectRoot, fileName, content) => {
      const path = fs.join(projectRoot, 'studies', fileName);
      await new Promise<void>((resolve) => { finishWrite = resolve; });
      fs.files.set(path, content);
    });
    useProjectStore.setState({ projectRoot: '/project' });
    const view = render(<QecStudySidebar fs={fs} />);
    await waitFor(() => expect(useQecStudyStore.getState().loading).toBe(false));
    fireEvent.click(view.getByRole('button', { name: 'New study' }));
    fireEvent.change(view.getByLabelText('Study name'), { target: { value: 'Pending' } });
    fireEvent.change(view.getByLabelText('Research question'), { target: { value: 'Still writing?' } });

    fireEvent.click(view.getByRole('button', { name: 'Create study' }));
    await waitFor(() => expect(view.getByRole('button', { name: 'Creating study…' }).hasAttribute('disabled')).toBe(true));
    expect(view.getByLabelText('Study name').hasAttribute('disabled')).toBe(true);

    finishWrite?.();
    await waitFor(() => expect(useQecStudyUiStore.getState().activeStudyId).toBe('pending'));
  });

  it('starts watching Studies for the active project after reload', async () => {
    const fs = memoryStudyFs({ '/active/studies/active.qec-study.yaml': studyYaml('active') });
    useProjectStore.setState({ projectRoot: '/active' });

    render(<QecStudySidebar fs={fs} />);

    await waitFor(() => expect(fs.watch).toHaveBeenCalledWith(
      '/active', expect.any(Function), { recursive: true },
    ));
  });

  it('keeps project B current when project A reload finishes late and never watches stale A', async () => {
    let releaseProjectA: (() => void) | undefined;
    const fs = memoryStudyFs({
      '/a/studies/a.qec-study.yaml': studyYaml('a'),
      '/b/studies/b.qec-study.yaml': studyYaml('b'),
    });
    const readDir = fs.readDir;
    fs.readDir = vi.fn(async (path: string) => {
      if (path === '/a/studies') await new Promise<void>((resolve) => { releaseProjectA = resolve; });
      return readDir(path);
    });
    useProjectStore.setState({ projectRoot: '/a' });
    render(<QecStudySidebar fs={fs} />);
    await waitFor(() => expect(releaseProjectA).toBeTypeOf('function'));

    useProjectStore.getState().setProjectRoot('/b');
    await waitFor(() => expect(fs.watch).toHaveBeenCalledWith(
      '/b', expect.any(Function), { recursive: true },
    ));
    releaseProjectA?.();
    await waitFor(() => expect(useQecStudyStore.getState().studies.map(({ study }) => study.id)).toEqual(['b']));

    expect(fs.watch.mock.calls.map(([path]) => path)).toEqual(['/b']);
  });

  it('clears the previous project Study scope synchronously on project switch', async () => {
    const fs = memoryStudyFs({
      '/a/studies/a.qec-study.yaml': studyYaml('a'),
      '/b/studies/b.qec-study.yaml': studyYaml('b'),
    });
    useProjectStore.setState({ projectRoot: '/a' });
    render(<QecStudySidebar fs={fs} />);
    await waitFor(() => expect(useQecStudyStore.getState().studies).toHaveLength(1));
    useQecStudyUiStore.getState().setActiveStudy('a');

    useProjectStore.getState().setProjectRoot('/b');

    expect(useQecStudyStore.getState().studies).toEqual([]);
    expect(useQecStudyUiStore.getState().activeStudyId).toBeNull();
    await waitFor(() => expect(useQecStudyStore.getState().studies.map(({ study }) => study.id)).toEqual(['b']));
  });

  it('stops the active watcher while retaining Studies across workspace navigation', async () => {
    const unwatch = vi.fn();
    const fs = memoryStudyFs({ '/active/studies/active.qec-study.yaml': studyYaml('active') });
    fs.watch.mockResolvedValue(unwatch);
    useProjectStore.setState({ projectRoot: '/active' });
    const view = render(<QecStudySidebar fs={fs} />);
    await waitFor(() => expect(fs.watch).toHaveBeenCalledOnce());

    view.unmount();

    expect(unwatch).toHaveBeenCalledOnce();
    expect(useQecStudyStore.getState().studies.map(({ study }) => study.id)).toEqual(['active']);
  });

  it('clears and invalidates a pending reload when the project root becomes null', async () => {
    let releaseRead: (() => void) | undefined;
    const fs = memoryStudyFs({ '/a/studies/a.qec-study.yaml': studyYaml('a') });
    const readDir = fs.readDir;
    fs.readDir = vi.fn(async (path: string) => {
      await new Promise<void>((resolve) => { releaseRead = resolve; });
      return readDir(path);
    });
    useProjectStore.setState({ projectRoot: '/a' });
    render(<QecStudySidebar fs={fs} />);
    await waitFor(() => expect(releaseRead).toBeTypeOf('function'));

    useProjectStore.getState().setProjectRoot(null);
    expect(useQecStudyStore.getState().studies).toEqual([]);
    releaseRead?.();
    await waitFor(() => expect(useQecStudyStore.getState().loading).toBe(false));

    expect(useQecStudyStore.getState().studies).toEqual([]);
    expect(fs.watch).not.toHaveBeenCalled();
  });

  it('renders watcher setup errors reported by the Study store', async () => {
    const fs = memoryStudyFs({ '/active/studies/active.qec-study.yaml': studyYaml('active') });
    fs.watch.mockRejectedValue(new Error('watch service unavailable'));
    useProjectStore.setState({ projectRoot: '/active' });
    const view = render(<QecStudySidebar fs={fs} />);

    expect(await view.findByText('Could not watch the Studies folder: watch service unavailable')).toBeTruthy();
  });

  it('labels every field visibly and puts the error under the field it belongs to (rq-r3-11)', async () => {
    const fs = memoryStudyFs();
    useProjectStore.setState({ projectRoot: '/project' });
    const view = render(<QecStudySidebar fs={fs} />);
    await waitFor(() => expect(useQecStudyStore.getState().loading).toBe(false));

    fireEvent.click(view.getByRole('button', { name: 'New study' }));
    for (const label of ['Study name', 'Research question', 'Starting preset']) {
      const control = view.getByLabelText(label);
      expect(view.container.querySelector(`label[for="${control.id}"]`)?.textContent).toBe(label);
      expect(control.getAttribute('placeholder')).toBeNull();
    }
    fireEvent.click(view.getByRole('button', { name: 'Create study' }));
    const name = view.getByLabelText('Study name');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    const alert = view.getByRole('alert');
    expect(name.getAttribute('aria-describedby')).toBe(alert.id);
    expect(alert.parentElement?.contains(name)).toBe(true);
    expect(view.getByLabelText('Research question').getAttribute('aria-invalid')).toBeNull();
  });
});
