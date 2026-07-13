// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { StatusBar } from './StatusBar';
import { PlatformProvider } from '../../platform/PlatformProvider';
import type { PlatformBridge } from '../../platform/bridge';
import { useCircuitStore } from '../../stores/circuitStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useExperimentRunStore } from '../../stores/experimentRunStore';

const bridge: PlatformBridge = {
  async startKernel() { return 'ok'; },
  async stopKernel() { return 'ok'; },
  async openFile() { return null; },
  async readFile() { return null; },
  async saveFile() {},
  async saveFileAs() { return null; },
  async renameFile() { return null; },
  async getStoredValue() { return null; },
  async setStoredValue() {},
  async setWindowTitle() {},
  getPlatform() { return 'desktop'; },
  async openDirectory() { return null; },
  async listDirectory() { return null; },
  async createFile() { return null; },
  async createDirectory() { return null; },
  async deleteFile() { return false; },
};

function renderStatusBar() {
  return render(
    <PlatformProvider bridge={bridge}>
      <StatusBar />
    </PlatformProvider>,
  );
}

afterEach(() => cleanup());

/**
 * PRD 11 Phase A — proves the StatusBar extracted from PanelLayout renders
 * the same slots it did inline. The extraction was byte-for-byte; these
 * assertions pin the observable structure so a future edit can't silently
 * drop a slot.
 */
describe('<StatusBar> (extracted from PanelLayout, Phase A)', () => {
  beforeEach(() => {
    useCircuitStore.setState({ snapshot: null });
    useSimulationStore.setState({ isRunning: false, result: null });
    useWorkspaceStore.setState({ mode: 'learn' });
    useExperimentRunStore.setState({ active: null });
  });

  it('renders the status-bar toolbar with its canonical slots', () => {
    const { getByRole, getByText } = renderStatusBar();
    const toolbar = getByRole('toolbar', { name: 'Status bar' });
    expect(toolbar).toBeTruthy();
    // Left slots
    expect(getByText('Qubits: —')).toBeTruthy();
    expect(getByText('Depth: —')).toBeTruthy();
    expect(getByRole('combobox', { name: 'Layout preset' })).toBeTruthy();
    // Right slots: kernel state, run status, mode toggle
    expect(getByText(/^Kernel/)).toBeTruthy();
    expect(getByText('Ready')).toBeTruthy();
    expect(getByRole('button', { name: 'Switch workspace mode' })).toBeTruthy();
  });

  it('reflects circuit stats from the circuit store', () => {
    useCircuitStore.setState({
      snapshot: {
        framework: 'qiskit',
        qubit_count: 3,
        classical_bit_count: 3,
        depth: 5,
        gates: [],
      },
    });
    const { getByText } = renderStatusBar();
    expect(getByText('Qubits: 3')).toBeTruthy();
    expect(getByText('Depth: 5')).toBeTruthy();
  });

  it('labels the workspace-mode toggle by the active mode', () => {
    useWorkspaceStore.setState({ mode: 'research' });
    const { getByRole } = renderStatusBar();
    const toggle = getByRole('button', { name: 'Switch workspace mode' });
    expect(toggle.textContent).toBe('Research');
  });

  it('shows the Research-mode sweep indicator when a run is active', () => {
    useWorkspaceStore.setState({ mode: 'research' });
    useExperimentRunStore.setState({
      active: {
        experimentName: 'theta-sweep',
        experimentFileName: 'theta-sweep.experiment.yaml',
        cancel: () => {},
        progress: { completed: 3, total: 8, failures: 0, currentPoint: 3 },
      },
    });
    const { getByText } = renderStatusBar();
    expect(getByText(/theta-sweep: 3\/8/)).toBeTruthy();
  });
});
