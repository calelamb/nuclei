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

vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: mkdirMock,
  writeTextFile: writeTextFileMock,
  readDir: vi.fn(async () => []),
  readTextFile: vi.fn(async () => ''),
  exists: vi.fn(async () => false),
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

    const nameInput = document.querySelector('input[placeholder="theta"]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'theta' } });
    const valuesSelect = nameInput.parentElement!.querySelector('select') as HTMLSelectElement;
    fireEvent.change(valuesSelect, { target: { value: 'values' } });
    const valuesInput = nameInput.parentElement!.querySelector('input[placeholder="0, 1, 2"]') as HTMLInputElement;
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

    const nameInput = document.querySelector('input[placeholder="theta"]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'theta' } });
    const [startInput, stopInput] = Array.from(
      nameInput.parentElement!.querySelectorAll('input[placeholder="start"], input[placeholder="stop"]'),
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
});
