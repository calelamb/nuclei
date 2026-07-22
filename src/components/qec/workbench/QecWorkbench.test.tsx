// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQecStudyStore } from '../../../services/qecStudyStore';
import { PlatformProvider } from '../../../platform/PlatformProvider';
import { useProjectStore } from '../../../stores/projectStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import {
  EMPTY_RESEARCH_SELECTION,
  useResearchSelectionStore,
} from '../../../stores/researchSelectionStore';
import { QecWorkbench } from './QecWorkbench';
import { deferred, flushAsync, flushPersistenceDebounce, MemoryStorage,
  persistedState, persistenceBridge } from './qecWorkbenchTestUtils';

const STUDY = {
  schema: 1 as const,
  id: 'surface-memory',
  name: 'Surface Memory',
  question: 'Which decoder reduces logical error?',
  preset: 'build' as const,
  tags: ['memory'],
  sources: [
    { id: 'circuit-d7', kind: 'stim' as const, path: 'circuits/surface-d7.stim' },
    { id: 'campaign-a', kind: 'experiment' as const, path: 'experiments/memory.experiment.yaml' },
  ],
};

const SECOND_STUDY = {
  ...STUDY,
  id: 'decoder-study',
  name: 'Decoder Study',
  question: 'Which decoder has the best tail latency?',
  preset: 'analyze' as const,
  sources: [],
};

const STUDY_UI_ACTIONS = {
  clearActiveStudy: useQecStudyUiStore.getState().clearActiveStudy,
  setActiveStudy: useQecStudyUiStore.getState().setActiveStudy,
};

function setStudies(studies = [STUDY, SECOND_STUDY]): void {
  useQecStudyStore.setState({
    projectRoot: '/project',
    studies: studies.map((study) => ({
      fileName: `${study.id}.qec-study.yaml`,
      path: `studies/${study.id}.qec-study.yaml`,
      study,
    })),
    validationErrors: [],
    loading: false,
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
  useProjectStore.setState({ projectRoot: null, tabs: [], activeTabPath: null });
  setStudies([STUDY]);
  useQecStudyUiStore.setState({ activeStudyId: STUDY.id, ...STUDY_UI_ACTIONS });
  useQecWorkbenchStore.setState({
    preset: 'build',
    pinnedPanelIds: [],
    sourceWidth: 280,
    inspectorWidth: 360,
    trayHeight: 260,
    trayCollapsed: false,
    persistenceError: null,
    persistenceIssue: null,
  });
  useResearchSelectionStore.setState({
    past: [],
    present: EMPTY_RESEARCH_SELECTION,
    future: [],
  });
});

describe('<QecWorkbench />', () => {
  it('renders four named regions and moves between presets', () => {
    render(<QecWorkbench />);

    const sources = screen.getByRole('navigation', { name: 'QEC sources and data' });
    const canvas = screen.getByRole('main', { name: 'QEC investigation canvas' });
    const inspector = screen.getByRole('complementary', { name: 'Research inspector' });
    const tray = screen.getByRole('region', { name: 'QEC jobs and streams' });
    const isBefore = (first: Element, second: Element): boolean =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(isBefore(sources, canvas)).toBe(true);
    expect(isBefore(canvas, inspector)).toBe(true);
    expect(isBefore(inspector, tray)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(useQecWorkbenchStore.getState().preset).toBe('analyze');
    expect(screen.getByRole('button', { name: 'Analyze' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('uses the active Study and panel registry to populate shell instruments', () => {
    render(<QecWorkbench />);

    expect(screen.getByRole('combobox', { name: 'Active QEC Study' })).toHaveProperty(
      'value',
      STUDY.id,
    );
    const canvas = screen.getByRole('main', { name: 'QEC investigation canvas' });
    expect(within(canvas).getByText('Timeline')).toBeTruthy();
    expect(within(canvas).getByText('Code Lattice')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(within(canvas).getByText('Campaign Center')).toBeTruthy();
  });

  it('uses a native labeled Study control and preserves keyboard selection semantics', () => {
    setStudies();
    render(<QecWorkbench />);

    const picker = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Active QEC Study' });
    picker.focus();
    fireEvent.keyDown(picker, { key: 'ArrowDown' });
    fireEvent.change(picker, { target: { value: SECOND_STUDY.id } });

    expect(document.activeElement).toBe(picker);
    expect(useQecStudyUiStore.getState().activeStudyId).toBe(SECOND_STUDY.id);
    expect(picker.value).toBe(SECOND_STUDY.id);
  });

  it('clears Study selection through the explicit UI-store action', () => {
    const clearActiveStudy = vi.fn(STUDY_UI_ACTIONS.clearActiveStudy);
    useQecStudyUiStore.setState({ clearActiveStudy });
    render(<QecWorkbench />);

    fireEvent.change(
      screen.getByRole<HTMLSelectElement>('combobox', { name: 'Active QEC Study' }),
      { target: { value: '' } },
    );

    expect(clearActiveStudy).toHaveBeenCalledOnce();
    expect(useQecStudyUiStore.getState().activeStudyId).toBeNull();
  });

  it('asks for a Study choice when Studies exist but the active id is stale', () => {
    setStudies();
    useQecStudyUiStore.setState({ activeStudyId: 'missing-study' });
    render(<QecWorkbench />);

    expect(screen.getByText('Choose a Study')).toBeTruthy();
    expect(screen.getByText(/Use the Study control/)).toBeTruthy();
    expect(screen.queryByText('No Studies found')).toBeNull();
  });

  it('opens and closes the responsive inspector with Escape and returns focus', () => {
    render(<QecWorkbench />);

    const toggle = screen.getByRole('button', { name: 'Hide research inspector' });
    const inspector = screen.getByRole('complementary', { name: 'Research inspector' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(inspector.id);

    fireEvent.click(within(inspector).getByRole('button', { name: 'Close research inspector' }));
    expect(screen.queryByRole('complementary', { name: 'Research inspector' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show research inspector' })).toBe(document.activeElement);

    fireEvent.click(screen.getByRole('button', { name: 'Show research inspector' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Research inspector' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show research inspector' })).toBe(document.activeElement);
  });

  it('moves backward and forward through the shared Research Trail', () => {
    useResearchSelectionStore.getState().selectPrimary(
      { kind: 'campaign-point', id: 'p=.004' },
      'user',
    );
    useResearchSelectionStore.getState().refineScope(
      { kind: 'detector', id: 'D42' },
      'user',
    );
    render(<QecWorkbench />);

    const trail = screen.getByRole('navigation', { name: 'Research trail' });
    expect(within(trail).getByText('p=.004')).toBeTruthy();
    expect(within(trail).getByText('D42')).toBeTruthy();

    fireEvent.click(within(trail).getByRole('button', { name: 'Back in research trail' }));
    expect(within(trail).queryByText('D42')).toBeNull();
    expect(within(trail).getByRole<HTMLButtonElement>('button', { name: 'Forward in research trail' }).disabled).toBe(false);
  });

  it('renders complete entity identities without duplicate React keys', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useResearchSelectionStore.getState().selectPrimary(
      { kind: 'tick', id: '1', sessionId: 's1', datasetId: 'd1' },
      'user',
    );
    useResearchSelectionStore.getState().refineScope(
      { kind: 'tick', id: '1', sessionId: 's1', datasetId: 'd2' },
      'user',
    );
    render(<QecWorkbench />);

    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(4);
    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key"/i);
    consoleError.mockRestore();
  });

  it('keeps tray lifecycle content available while allowing it to collapse', () => {
    render(<QecWorkbench />);

    const tray = screen.getByRole('region', { name: 'QEC jobs and streams' });
    const toggle = within(tray).getByRole('button', { name: 'Collapse jobs and streams' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(tray).getByText('No active jobs')).toBeTruthy();

    fireEvent.click(toggle);
    expect(useQecWorkbenchStore.getState().trayCollapsed).toBe(true);
    expect(
      within(tray).getByRole('button', { name: 'Expand jobs and streams' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(within(tray).queryByText('No active jobs')).toBeNull();
  });

  it('hydrates scoped context and debounces an immutable platform-store snapshot', async () => {
    useProjectStore.setState({ projectRoot: '/project' });
    const writes: Array<{ key: string; value: unknown }> = [];
    const bridge = persistenceBridge(
      vi.fn(async () => persistedState('analyze')),
      vi.fn(async (key, value) => { writes.push({ key, value }); }),
    );

    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);

    await waitFor(() => expect(useQecWorkbenchStore.getState().preset).toBe('analyze'));
    expect(useResearchSelectionStore.getState().present).toMatchObject({
      primary: { kind: 'detector', id: 'D42' },
      source: 'restore',
    });
    expect(useQecWorkbenchStore.getState().trayCollapsed).toBe(true);

    act(() => useQecWorkbenchStore.getState().setPreset('observe'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      key: `qec-workbench:/project:${STUDY.id}`,
      value: { schema: 1, preset: 'observe', trayCollapsed: true },
    });
  });

  it('ignores a stale load when the active Study switches', async () => {
    setStudies();
    useProjectStore.setState({ projectRoot: '/project' });
    let resolveFirst: ((value: unknown) => void) | null = null;
    const first = new Promise<unknown>((resolve) => { resolveFirst = resolve; });
    const bridge = persistenceBridge(vi.fn(async (key: string) =>
      key.endsWith(STUDY.id) ? first : persistedState('observe')));
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);

    act(() => useQecStudyUiStore.getState().setActiveStudy(SECOND_STUDY.id));
    await waitFor(() => expect(useQecWorkbenchStore.getState().preset).toBe('observe'));
    await act(async () => { resolveFirst?.(persistedState('analyze')); await first; });

    expect(useQecWorkbenchStore.getState().preset).toBe('observe');
  });

  it.each([
    [SECOND_STUDY, 'analyze'],
    [{ ...SECOND_STUDY, id: 'observe-study', preset: 'observe' as const }, 'observe'],
  ] as const)('uses a newly selected Study manifest preset when no stored scope exists', async (study, preset) => {
    setStudies([STUDY, study]);
    useProjectStore.setState({ projectRoot: '/project' });
    const bridge = persistenceBridge(vi.fn(async () => null));
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await waitFor(() => expect(useQecWorkbenchStore.getState().preset).toBe('build'));

    act(() => useQecStudyUiStore.getState().setActiveStudy(study.id));

    await waitFor(() => expect(useQecWorkbenchStore.getState().preset).toBe(preset));
  });

  it('lets a valid stored preset override the selected Study manifest preset', async () => {
    setStudies([STUDY, SECOND_STUDY]);
    useProjectStore.setState({ projectRoot: '/project' });
    const bridge = persistenceBridge(vi.fn(async (key: string) =>
      key.endsWith(SECOND_STUDY.id) ? persistedState('observe') : null));
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);

    act(() => useQecStudyUiStore.getState().setActiveStudy(SECOND_STUDY.id));

    await waitFor(() => expect(useQecWorkbenchStore.getState().preset).toBe('observe'));
  });

  it('merges a pending read without overwriting same-scope local edits', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const read = deferred<unknown>();
    const writes: unknown[] = [];
    const bridge = persistenceBridge(
      vi.fn(async () => read.promise),
      vi.fn(async (_key, value) => { writes.push(value); }),
    );
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);

    act(() => {
      useQecWorkbenchStore.getState().setPreset('observe');
      useResearchSelectionStore.getState().selectPrimary(
        { kind: 'finding', id: 'local-finding' },
        'user',
      );
    });
    read.resolve(persistedState('analyze'));
    await flushAsync();

    expect(useQecWorkbenchStore.getState()).toMatchObject({
      preset: 'observe',
      inspectorWidth: 410,
    });
    expect(useResearchSelectionStore.getState().present.primary).toMatchObject({
      kind: 'finding', id: 'local-finding',
    });
    await flushPersistenceDebounce();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      preset: 'observe',
      selection: { primary: { kind: 'finding', id: 'local-finding' } },
    });
  });

  it('serializes in-flight saves and coalesces two later changes to the newest snapshot', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const values: unknown[] = [];
    const setStoredValue = vi.fn(async (_key: string, value: unknown) => {
      values.push(value);
      return values.length === 1 ? firstWrite.promise : secondWrite.promise;
    });
    const bridge = persistenceBridge(vi.fn(async () => persistedState('build')), setStoredValue);
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();

    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    await flushPersistenceDebounce();
    act(() => {
      useQecWorkbenchStore.getState().setPreset('observe');
      useQecWorkbenchStore.getState().setTrayCollapsed(false);
    });
    await flushPersistenceDebounce();
    expect(setStoredValue).toHaveBeenCalledTimes(1);

    firstWrite.resolve();
    await flushAsync();
    expect(setStoredValue).toHaveBeenCalledTimes(2);
    expect(values[1]).toMatchObject({ preset: 'observe', trayCollapsed: false });
    secondWrite.resolve();
    await flushAsync();
  });

  it('keeps a newer write failure status when an older retry completes late', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const firstWrite = deferred<void>();
    const retryWrite = deferred<void>();
    const newestWrite = deferred<void>();
    const attempts = [firstWrite, retryWrite, newestWrite];
    const setStoredValue = vi.fn(async () => attempts[setStoredValue.mock.calls.length - 1].promise);
    const bridge = persistenceBridge(vi.fn(async () => persistedState('build')), setStoredValue);
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();

    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    await flushPersistenceDebounce();
    firstWrite.reject(new Error('first failure'));
    await flushAsync();
    const retry = screen.getByRole<HTMLButtonElement>('button', { name: 'Retry save' });
    fireEvent.click(retry, { detail: 0 });
    expect(retry.disabled).toBe(true);

    act(() => useQecWorkbenchStore.getState().setPreset('observe'));
    await flushPersistenceDebounce();
    retryWrite.resolve();
    await flushAsync();
    expect(screen.getByRole('alert').textContent).toMatch(/save QEC workspace context/i);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Retry save' }).disabled).toBe(true);

    newestWrite.reject(new Error('newest failure'));
    await flushAsync();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Retry save' }).disabled).toBe(false);
  });

  it('ignores a late in-flight save failure after switching persistence scope', async () => {
    vi.useFakeTimers();
    setStudies();
    useProjectStore.setState({ projectRoot: '/project' });
    const oldWrite = deferred<void>();
    const setStoredValue = vi.fn(async () => oldWrite.promise);
    const bridge = persistenceBridge(vi.fn(async (key: string) =>
      key.endsWith(SECOND_STUDY.id) ? persistedState('observe') : persistedState('build')),
    setStoredValue);
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();

    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    await flushPersistenceDebounce();
    expect(setStoredValue).toHaveBeenCalledTimes(1);
    act(() => useQecStudyUiStore.getState().setActiveStudy(SECOND_STUDY.id));
    await flushAsync();
    expect(useQecWorkbenchStore.getState().preset).toBe('observe');

    oldWrite.reject(new Error('late old-scope failure'));
    await flushAsync();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useQecWorkbenchStore.getState().preset).toBe('observe');
  });

  it('keeps the replacement ABA write last after a disposed session reserves a retry', async () => {
    vi.useFakeTimers();
    setStudies();
    useProjectStore.setState({ projectRoot: '/project' });
    const oldAWrite = deferred<void>();
    const invocations: Array<{ key: string; value: unknown }> = [];
    const durable = new Map<string, unknown>();
    const setStoredValue = vi.fn(async (key: string, value: unknown) => {
      invocations.push({ key, value });
      if (invocations.length === 1) await oldAWrite.promise;
      durable.set(key, value);
    });
    const bridge = persistenceBridge(vi.fn(async () => persistedState('build')), setStoredValue);
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();

    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    await flushPersistenceDebounce();
    act(() => useQecStudyUiStore.getState().setActiveStudy(SECOND_STUDY.id));
    await flushAsync();
    act(() => useQecStudyUiStore.getState().setActiveStudy(STUDY.id));
    await flushAsync();
    act(() => useQecWorkbenchStore.getState().setPreset('observe'));
    await flushPersistenceDebounce();

    expect(setStoredValue).toHaveBeenCalledTimes(1);
    oldAWrite.resolve();
    await flushAsync();
    expect(setStoredValue).toHaveBeenCalledTimes(3);
    expect(invocations[1]).toMatchObject({
      key: `qec-workbench:/project:${STUDY.id}`,
      value: { preset: 'analyze' },
    });
    expect(invocations.at(-1)).toMatchObject({
      key: `qec-workbench:/project:${STUDY.id}`,
      value: { preset: 'observe' },
    });
    expect(durable.get(`qec-workbench:/project:${STUDY.id}`)).toMatchObject({ preset: 'observe' });
  });

  it('reserves pending-read disposal order before a replacement ABA write', async () => {
    vi.useFakeTimers();
    setStudies();
    useProjectStore.setState({ projectRoot: '/project' });
    const oldRead = deferred<unknown>();
    let firstARead = true;
    const durable = new Map<string, unknown>();
    const getStoredValue = vi.fn(async (key: string) => {
      if (key.endsWith(STUDY.id) && firstARead) {
        firstARead = false;
        return oldRead.promise;
      }
      return persistedState('build');
    });
    const setStoredValue = vi.fn(async (key: string, value: unknown) => {
      durable.set(key, value);
    });
    const bridge = persistenceBridge(getStoredValue, setStoredValue);
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);

    act(() => {
      useQecWorkbenchStore.getState().setPreset('observe');
      useQecStudyUiStore.getState().setActiveStudy(SECOND_STUDY.id);
    });
    await flushAsync();
    act(() => useQecStudyUiStore.getState().setActiveStudy(STUDY.id));
    await flushAsync();
    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    await flushPersistenceDebounce();
    expect(setStoredValue).not.toHaveBeenCalledWith(
      `qec-workbench:/project:${STUDY.id}`,
      expect.anything(),
    );

    oldRead.resolve(persistedState('build'));
    await flushAsync();
    await flushAsync();

    expect(durable.get(`qec-workbench:/project:${STUDY.id}`)).toMatchObject({ preset: 'analyze' });
  });

  it('keeps different persistence keys independent while one key is blocked', async () => {
    vi.useFakeTimers();
    setStudies();
    useProjectStore.setState({ projectRoot: '/project' });
    const oldAWrite = deferred<void>();
    const invocations: Array<{ key: string; value: unknown }> = [];
    const setStoredValue = vi.fn(async (key: string, value: unknown) => {
      invocations.push({ key, value });
      if (key.endsWith(STUDY.id)) await oldAWrite.promise;
    });
    const bridge = persistenceBridge(vi.fn(async () => persistedState('build')), setStoredValue);
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();

    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    await flushPersistenceDebounce();
    act(() => useQecStudyUiStore.getState().setActiveStudy(SECOND_STUDY.id));
    await flushAsync();
    act(() => useQecWorkbenchStore.getState().setPreset('observe'));
    await flushPersistenceDebounce();

    expect(setStoredValue).toHaveBeenCalledTimes(2);
    expect(invocations[1].key).toBe(`qec-workbench:/project:${SECOND_STUDY.id}`);
    oldAWrite.resolve();
    await flushAsync();
  });

  it('removes the disposed scope retry action when the active Study is cleared', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const bridge = persistenceBridge(vi.fn(async () => { throw new Error('read failed'); }));
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();
    expect(screen.getByRole('button', { name: 'Retry restore' })).toBeTruthy();

    act(() => useQecStudyUiStore.getState().clearActiveStudy());

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retries a failed restore from an accessible keyboard-operated action', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const retryRead = deferred<unknown>();
    const getStoredValue = vi.fn()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockImplementationOnce(async () => retryRead.promise);
    const bridge = persistenceBridge(getStoredValue);
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Retry restore to recover/i);
    const retry = within(alert).getByRole<HTMLButtonElement>('button', { name: 'Retry restore' });
    retry.focus();
    fireEvent.click(retry, { detail: 0 });
    expect(document.activeElement).toBe(retry);
    expect(retry.disabled).toBe(true);

    retryRead.resolve(persistedState('analyze'));
    await flushAsync();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useQecWorkbenchStore.getState().preset).toBe('analyze');
  });

  it('retries a failed save and clears its matching status after success', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const retryWrite = deferred<void>();
    const setStoredValue = vi.fn()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockImplementationOnce(async () => retryWrite.promise);
    const bridge = persistenceBridge(vi.fn(async () => persistedState('build')), setStoredValue);
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();
    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    await flushPersistenceDebounce();
    await flushAsync();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/Retry save to preserve/i);
    const retry = within(alert).getByRole<HTMLButtonElement>('button', { name: 'Retry save' });
    retry.focus();
    fireEvent.click(retry, { detail: 0 });
    expect(document.activeElement).toBe(retry);
    expect(retry.disabled).toBe(true);

    retryWrite.resolve();
    await flushAsync();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports platform read and write failures in the workbench shell', async () => {
    useProjectStore.setState({ projectRoot: '/project' });
    const readFailure = persistenceBridge(vi.fn(async () => { throw new Error('read failed'); }));
    const firstRender = render(
      <PlatformProvider bridge={readFailure}><QecWorkbench /></PlatformProvider>,
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(/restore QEC workspace context/i);
    firstRender.unmount();

    const writeFailure = persistenceBridge(
      vi.fn(async () => persistedState('build')),
      vi.fn(async () => { throw new Error('write failed'); }),
    );
    render(<PlatformProvider bridge={writeFailure}><QecWorkbench /></PlatformProvider>);
    await waitFor(() => expect(useQecWorkbenchStore.getState().persistenceError).toBeNull());
    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/save QEC workspace context/i);
  });

  it('flushes pending persistence when the shell unmounts', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const setStoredValue = vi.fn(async () => undefined);
    const bridge = persistenceBridge(vi.fn(async () => persistedState('build')), setStoredValue);
    const view = render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();
    expect(useQecWorkbenchStore.getState().trayCollapsed).toBe(true);

    act(() => useQecWorkbenchStore.getState().setPreset('analyze'));
    view.unmount();
    await flushAsync();

    expect(setStoredValue).toHaveBeenCalledWith(
      `qec-workbench:/project:${STUDY.id}`,
      expect.objectContaining({ preset: 'analyze' }),
    );
  });

  it('merges untouched stored fields before a pending-read disposal flush', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const read = deferred<unknown>();
    const setStoredValue = vi.fn(async () => undefined);
    const bridge = persistenceBridge(vi.fn(async () => read.promise), setStoredValue);
    const view = render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);

    act(() => useQecWorkbenchStore.getState().setPreset('observe'));
    view.unmount();
    read.resolve(persistedState('analyze'));
    await flushAsync();

    expect(setStoredValue).toHaveBeenCalledWith(
      `qec-workbench:/project:${STUDY.id}`,
      expect.objectContaining({ preset: 'observe', inspectorWidth: 410, trayCollapsed: true }),
    );
  });

  it('flushes local edits when a pending restore rejects after disposal', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const read = deferred<unknown>();
    const setStoredValue = vi.fn(async () => undefined);
    const bridge = persistenceBridge(vi.fn(async () => read.promise), setStoredValue);
    const view = render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);

    act(() => useQecWorkbenchStore.getState().setPreset('observe'));
    view.unmount();
    read.reject(new Error('restore unavailable'));
    await flushAsync();

    expect(setStoredValue).toHaveBeenCalledWith(
      `qec-workbench:/project:${STUDY.id}`,
      expect.objectContaining({ preset: 'observe' }),
    );
  });

  it('logs a scoped disposal-flush failure without publishing stale UI state', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bridge = persistenceBridge(
      vi.fn(async () => persistedState('build')),
      vi.fn(async () => { throw new Error('store offline'); }),
    );
    const view = render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();
    act(() => useQecWorkbenchStore.getState().setPreset('observe'));

    view.unmount();
    await flushAsync();

    expect(consoleError).toHaveBeenCalledWith(
      'QEC workspace disposal flush failed.',
      expect.objectContaining({
        scopeKey: `qec-workbench:/project:${STUDY.id}`,
        error: expect.any(Error),
      }),
    );
    expect(useQecWorkbenchStore.getState().persistenceIssue).toBeNull();
    consoleError.mockRestore();
  });

  it('queues the latest snapshot behind an in-flight write when disposing', async () => {
    vi.useFakeTimers();
    useProjectStore.setState({ projectRoot: '/project' });
    const firstWrite = deferred<void>();
    const setStoredValue = vi.fn(async () => {
      if (setStoredValue.mock.calls.length === 1) await firstWrite.promise;
    });
    const bridge = persistenceBridge(vi.fn(async () => persistedState('build')), setStoredValue);
    const view = render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();
    act(() => useQecWorkbenchStore.getState().setPreset('observe'));
    await flushPersistenceDebounce();
    expect(setStoredValue).toHaveBeenCalledTimes(1);

    view.unmount();
    firstWrite.reject(new Error('first write failed'));
    await flushAsync();
    await flushAsync();

    expect(setStoredValue).toHaveBeenCalledTimes(2);
    expect(setStoredValue.mock.calls[1]).toEqual([
      `qec-workbench:/project:${STUDY.id}`,
      expect.objectContaining({ preset: 'observe' }),
    ]);
    expect(useQecWorkbenchStore.getState().persistenceIssue).toBeNull();
  });

  it('flushes the old Study snapshot when scope switches before the debounce', async () => {
    vi.useFakeTimers();
    setStudies();
    useProjectStore.setState({ projectRoot: '/project' });
    const writes: Array<{ key: string; value: unknown }> = [];
    const bridge = persistenceBridge(
      vi.fn(async () => null),
      vi.fn(async (key, value) => { writes.push({ key, value }); }),
    );
    render(<PlatformProvider bridge={bridge}><QecWorkbench /></PlatformProvider>);
    await flushAsync();

    act(() => {
      useQecWorkbenchStore.getState().setPreset('observe');
      useQecStudyUiStore.getState().setActiveStudy(SECOND_STUDY.id);
    });
    await flushAsync();

    expect(writes).toContainEqual({
      key: `qec-workbench:/project:${STUDY.id}`,
      value: expect.objectContaining({ preset: 'observe' }),
    });
  });

  it('renders a distinct Study loading state', () => {
    useQecStudyUiStore.setState({ activeStudyId: null });
    useQecStudyStore.setState({ studies: [], validationErrors: [], loading: true });
    render(<QecWorkbench />);
    expect(screen.getByRole('status', { name: 'Loading QEC Studies' })).toBeTruthy();
    expect(screen.getByText('Parsing and validating Study manifests.')).toBeTruthy();
    expect(screen.queryByText(/referenced sources/i)).toBeNull();
  });

  it('renders malformed Study file names and actionable validation details', () => {
    useQecStudyUiStore.setState({ activeStudyId: null });
    useQecStudyStore.setState({
      studies: [],
      loading: false,
      validationErrors: [{
        fileName: 'broken.qec-study.yaml',
        errors: ['question: Required', 'sources.0.path: path must stay inside the project'],
      }],
    });
    render(<QecWorkbench />);
    expect(screen.getByRole('alert', { name: 'Study validation issues' })).toBeTruthy();
    expect(screen.getByText('broken.qec-study.yaml')).toBeTruthy();
    expect(screen.getByText('question: Required')).toBeTruthy();
    expect(screen.getByText(/path must stay inside the project/)).toBeTruthy();
    expect(screen.getByText(/Fix these fields and save/)).toBeTruthy();
    expect(screen.getByText('2 validation issues')).toBeTruthy();
  });

  it('renders a safe empty state when no Studies exist', () => {
    useQecStudyUiStore.setState({ activeStudyId: null });
    useQecStudyStore.setState({ studies: [], validationErrors: [], loading: false });
    render(<QecWorkbench />);
    expect(screen.getByText('No Studies found')).toBeTruthy();
    expect(screen.getByText(/Create a Study manifest/)).toBeTruthy();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Active QEC Study' }).disabled).toBe(true);
    expect(screen.getByText('Not evaluated')).toBeTruthy();
    expect(screen.getAllByText('Provenance not evaluated')).toHaveLength(2);
  });

  it('distinguishes manifest validity from provenance evaluation', () => {
    render(<QecWorkbench />);
    expect(screen.getByText('Manifest valid')).toBeTruthy();
    expect(screen.getAllByText('Provenance not evaluated')).toHaveLength(2);
    expect(screen.queryByText('Validated')).toBeNull();
    expect(screen.queryByText('Provenance ready')).toBeNull();
  });

});
