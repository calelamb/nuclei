// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { parse as parseYaml } from 'yaml';
import { NewExperimentForm } from './NewExperimentForm';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentStore, type DiscoveredExperiment } from '../../services/experimentStore';
import { useHardwareStore } from '../../stores/hardwareStore';

const mkdirMock = vi.hoisted(() => vi.fn(async () => {}));
const writeTextFileMock = vi.hoisted(() => vi.fn(async () => {}));
const existsMock = vi.hoisted(() => vi.fn<(path: string) => Promise<boolean>>(async () => false));

vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: mkdirMock,
  writeTextFile: writeTextFileMock,
  readDir: vi.fn(async () => []),
  readTextFile: vi.fn(async () => ''),
  exists: existsMock,
  watch: vi.fn(async () => () => {}),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }));

const EXISTING: DiscoveredExperiment = {
  fileName: 'theta-sweep.experiment.yaml',
  path: '/proj/experiments/theta-sweep.experiment.yaml',
  spec: {
    schema: 1,
    name: 'theta-sweep',
    entry: 'run.py',
    language: 'python',
    backend: { provider: 'simulator', target: 'statevector' },
    shots: 100,
    seed: 42,
  },
};

describe('NewExperimentForm', () => {
  beforeEach(() => {
    useProjectStore.setState({ projectRoot: '/proj', tabs: [], activeTabPath: null });
    useExperimentStore.setState({
      loading: false,
      experiments: [],
      validationErrors: [],
      runsByExperiment: {},
      reload: vi.fn(async () => {}),
      scanRuns: vi.fn(async () => {}),
      startWatching: vi.fn(async () => {}),
      stopWatching: vi.fn(),
    });
    useHardwareStore.setState({ backends: [] });
    mkdirMock.mockClear();
    writeTextFileMock.mockClear();
    existsMock.mockReset();
    existsMock.mockResolvedValue(false);
  });

  afterEach(() => {
    cleanup();
    useProjectStore.setState({ projectRoot: null, tabs: [], activeTabPath: null });
  });

  it('writes the expected serialized YAML and opens the file in the editor', async () => {
    const onClose = vi.fn();
    const { getByLabelText, getByText } = render(
      <NewExperimentForm projectRoot="/proj" onClose={onClose} />,
    );

    fireEvent.change(getByLabelText('Name'), { target: { value: 'Theta Sweep' } });
    fireEvent.change(getByLabelText('Entry file'), { target: { value: 'run.py' } });
    fireEvent.change(getByLabelText('Shots'), { target: { value: '2048' } });
    fireEvent.change(getByLabelText('Seed'), { target: { value: '7' } });

    fireEvent.click(getByText('Create experiment'));

    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(1));

    expect(mkdirMock).toHaveBeenCalledWith('/proj/experiments', { recursive: true });

    const [path, content] = writeTextFileMock.mock.calls[0] as [string, string];
    expect(path).toBe('/proj/experiments/theta-sweep.experiment.yaml');
    expect(parseYaml(content)).toEqual({
      schema: 1,
      name: 'Theta Sweep',
      entry: 'run.py',
      language: 'python',
      backend: { provider: 'simulator', target: 'statevector' },
      shots: 2048,
      seed: 7,
    });

    expect(useProjectStore.getState().tabs.map((t) => t.path)).toContain(path);
    expect(useProjectStore.getState().tabs.find((t) => t.path === path)?.content).toBe(content);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('serializes a sweep and notes when present', async () => {
    const { getByLabelText, getByText } = render(
      <NewExperimentForm projectRoot="/proj" onClose={vi.fn()} />,
    );
    fireEvent.change(getByLabelText('Name'), { target: { value: 'theta-sweep' } });
    fireEvent.change(getByLabelText('Entry file'), { target: { value: 'run.py' } });
    fireEvent.change(getByLabelText('Notes (optional)'), { target: { value: 'H2 ansatz sweep' } });
    fireEvent.click(getByText('Add'));

    const nameInput = document.querySelector('input[aria-label="Parameter name"]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'theta' } });
    const valuesSelect = nameInput.closest('[data-sweep-row]')!.querySelector('select') as HTMLSelectElement;
    fireEvent.change(valuesSelect, { target: { value: 'values' } });
    const valuesInput = nameInput.closest('[data-sweep-row]')!.querySelector('input[placeholder="0, 1, 2"]') as HTMLInputElement;
    fireEvent.change(valuesInput, { target: { value: '0, 1, 2' } });

    fireEvent.click(getByText('Create experiment'));
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(1));

    const [, content] = writeTextFileMock.mock.calls[0] as [string, string];
    const parsed = parseYaml(content);
    expect(parsed.sweep).toEqual({ theta: { values: [0, 1, 2] } });
    expect(parsed.notes).toBe('H2 ansatz sweep');
  });

  it('shows the grid-size cap error and disables submit above 500 points', () => {
    const { getByLabelText, getByText } = render(
      <NewExperimentForm projectRoot="/proj" onClose={vi.fn()} />,
    );
    fireEvent.change(getByLabelText('Name'), { target: { value: 'big-sweep' } });
    fireEvent.change(getByLabelText('Entry file'), { target: { value: 'run.py' } });
    fireEvent.click(getByText('Add'));

    const nameInput = document.querySelector('input[aria-label="Parameter name"]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'theta' } });
    const [startInput, stopInput] = Array.from(
      nameInput.closest('[data-sweep-row]')!.querySelectorAll('input[placeholder="start"], input[placeholder="stop"]'),
    ) as HTMLInputElement[];
    fireEvent.change(startInput, { target: { value: '0' } });
    fireEvent.change(stopInput, { target: { value: '1000' } }); // step defaults to 0.1 -> >500 points

    expect(getByText(/exceeds the v1 cap of 500/)).toBeTruthy();
    expect(getByText('Create experiment')).toHaveProperty('disabled', true);
  });

  it('re-syncs from an external store change while editing, until the user starts typing', () => {
    useExperimentStore.setState({ experiments: [EXISTING] });
    const { getByLabelText } = render(
      <NewExperimentForm projectRoot="/proj" existing={EXISTING} onClose={vi.fn()} />,
    );
    expect((getByLabelText('Shots') as HTMLInputElement).value).toBe('100');

    // Simulate the store's file watcher picking up a hand-edit on disk.
    act(() => {
      useExperimentStore.setState({ experiments: [{ ...EXISTING, spec: { ...EXISTING.spec, shots: 4096 } }] });
    });
    expect((getByLabelText('Shots') as HTMLInputElement).value).toBe('4096');

    // Once the user edits a field, further external changes no longer clobber it.
    fireEvent.change(getByLabelText('Shots'), { target: { value: '256' } });
    act(() => {
      useExperimentStore.setState({ experiments: [{ ...EXISTING, spec: { ...EXISTING.spec, shots: 9999 } }] });
    });
    expect((getByLabelText('Shots') as HTMLInputElement).value).toBe('256');
  });

  it('does not show validation errors before the user has touched anything (research-22)', () => {
    const { queryByText, container } = render(
      <NewExperimentForm projectRoot="/proj" onClose={vi.fn()} />,
    );
    expect(container.querySelector('ul')).toBeNull();
    expect(queryByText(/Too small/)).toBeNull();
    expect(container.textContent).toContain('1 point (no sweep)');
  });

  it('shows human copy for a missing entry file once the field was touched (research-22)', () => {
    const { getByLabelText, getByText, queryByText } = render(
      <NewExperimentForm projectRoot="/proj" onClose={vi.fn()} />,
    );
    fireEvent.change(getByLabelText('Name'), { target: { value: 'x' } });
    expect(queryByText(/Choose the file to run/)).toBeNull();
    fireEvent.change(getByLabelText('Entry file'), { target: { value: 'a' } });
    fireEvent.change(getByLabelText('Entry file'), { target: { value: '' } });
    expect(getByText(/Choose the file to run/)).toBeTruthy();
    expect(queryByText(/Too small/)).toBeNull();
  });

  it('titles the edit form with the experiment name (research-01)', () => {
    const { getByText } = render(
      <NewExperimentForm projectRoot="/proj" existing={EXISTING} onClose={vi.fn()} />,
    );
    expect(getByText('Edit theta-sweep')).toBeTruthy();
  });

  it('asks before discarding unsaved edits on Close (research-01)', () => {
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { getByLabelText, getByText } = render(
      <NewExperimentForm projectRoot="/proj" existing={EXISTING} onClose={onClose} />,
    );
    fireEvent.click(getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1); // clean form closes silently
    fireEvent.change(getByLabelText('Shots'), { target: { value: '5' } });
    fireEvent.click(getByText('Close'));
    expect(confirmSpy).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1); // user declined
    confirmSpy.mockReturnValue(true);
    fireEvent.click(getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(2);
    confirmSpy.mockRestore();
  });

  it('blocks a new experiment whose name collides with an existing one (LR-01)', () => {
    useExperimentStore.setState({ experiments: [EXISTING] });
    const { getByLabelText, getByText, getByRole } = render(
      <NewExperimentForm projectRoot="/proj" onClose={vi.fn()} />,
    );
    fireEvent.change(getByLabelText('Name'), { target: { value: 'Theta Sweep' } });
    fireEvent.change(getByLabelText('Entry file'), { target: { value: 'other.py' } });
    expect(getByRole('alert').textContent).toMatch(/already exists/i);
    const submit = getByText('Create experiment') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });

  it('refuses to write over a file that exists on disk but is not yet in the store (LR-01)', async () => {
    existsMock.mockResolvedValue(true);
    const { getByLabelText, getByText, findByText } = render(
      <NewExperimentForm projectRoot="/proj" onClose={vi.fn()} />,
    );
    fireEvent.change(getByLabelText('Name'), { target: { value: 'fresh' } });
    fireEvent.change(getByLabelText('Entry file'), { target: { value: 'run.py' } });
    fireEvent.click(getByText('Create experiment'));
    expect(await findByText(/already exists/i)).toBeTruthy();
    expect(writeTextFileMock).not.toHaveBeenCalled();
  });

  it('still lets an existing experiment be saved under its own name (LR-01)', async () => {
    useExperimentStore.setState({ experiments: [EXISTING] });
    const { getByText } = render(
      <NewExperimentForm projectRoot="/proj" existing={EXISTING} onClose={vi.fn()} />,
    );
    fireEvent.click(getByText('Save changes'));
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalledTimes(1));
    expect(existsMock).not.toHaveBeenCalled();
  });

  it('flags unnamed sweep rows instead of silently ignoring them (research-r-09)', () => {
    const { getByText, getAllByText } = render(
      <NewExperimentForm projectRoot="/proj" onClose={vi.fn()} />,
    );
    fireEvent.click(getByText('Add'));
    fireEvent.click(getByText('Add'));
    expect(getAllByText('Name this parameter to include it in the sweep.')).toHaveLength(2);
    expect(getByText(/2 parameters unnamed/)).toBeTruthy();
    expect(document.querySelector('input[placeholder="theta"]')).toBeNull();
  });

  describe('focus (research-r-06)', () => {
    it('takes focus on the Name field when it opens', () => {
      const { getByLabelText } = render(<NewExperimentForm projectRoot="/proj" onClose={vi.fn()} />);
      expect(document.activeElement).toBe(getByLabelText('Name'));
    });

    it('returns focus to the control that opened it when it closes', async () => {
      const opener = document.createElement('button');
      document.body.appendChild(opener);
      opener.focus();
      const onClose = vi.fn();
      const { getByText } = render(<NewExperimentForm projectRoot="/proj" onClose={onClose} />);
      fireEvent.click(getByText('Close'));
      expect(onClose).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(document.activeElement).toBe(opener));
      opener.remove();
    });

    it('closes a pristine form on Escape', () => {
      const onClose = vi.fn();
      const { getByLabelText } = render(<NewExperimentForm projectRoot="/proj" onClose={onClose} />);
      fireEvent.keyDown(getByLabelText('Name'), { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not discard edits on Escape: it moves focus to Close instead', () => {
      const onClose = vi.fn();
      const { getByLabelText, getByText } = render(<NewExperimentForm projectRoot="/proj" onClose={onClose} />);
      fireEvent.change(getByLabelText('Name'), { target: { value: 'half-typed' } });
      fireEvent.keyDown(getByLabelText('Name'), { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(getByText('Close').closest('button'));
    });
  });
});
