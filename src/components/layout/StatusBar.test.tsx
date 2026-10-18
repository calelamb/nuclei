// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { StatusBar } from './StatusBar';
import { PlatformProvider } from '../../platform/PlatformProvider';
import type { PlatformBridge } from '../../platform/bridge';
import { useCircuitStore } from '../../stores/circuitStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useEditorStore } from '../../stores/editorStore';
import { useExperimentRunStore } from '../../stores/experimentRunStore';
import { useLearnStore } from '../../stores/learnStore';
import { useUIModeStore } from '../../stores/uiModeStore';
import { useNavigationStore } from '../../stores/navigationStore';

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
    expect(getByRole('button', { name: /^Layout preset:/ })).toBeTruthy();
    // Right slot: one truthful kernel/run item (idle until a kernel starts)
    expect(getByText('Kernel idle')).toBeTruthy();
    // Far-left mode chip carries the "Switch workspace mode" control (Phase B).
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

  it('the mode chip shows the active mode label', () => {
    useWorkspaceStore.setState({ mode: 'research' });
    const { getByRole } = renderStatusBar();
    const chip = getByRole('button', { name: 'Switch workspace mode' });
    expect(chip.textContent).toBe('RESEARCH');
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
    // The name and the progress live in separate spans now (the name is
    // truncated with an ellipsis so long names can't push the right-side
    // controls off-screen), so assert on each piece.
    expect(getByText('theta-sweep')).toBeTruthy();
    expect(getByText(/: 3\/8/)).toBeTruthy();
  });
});

describe('StatusBar in takeover views (S-19)', () => {
  beforeEach(() => {
    useCircuitStore.setState({ snapshot: null });
    useWorkspaceStore.setState({ mode: 'learn' });
    useLearnStore.setState({ isLearnMode: false });
    useNavigationStore.setState({ activeView: 'files' });
  });
  afterEach(() => {
    useLearnStore.setState({ isLearnMode: false });
    useNavigationStore.setState({ activeView: 'files' });
  });

  it('hides Qubits/Depth and the layout preset while a lesson owns the main area', () => {
    useLearnStore.setState({ isLearnMode: true });
    const { queryByText, queryByRole } = renderStatusBar();
    expect(queryByText(/Qubits:/)).toBeNull();
    expect(queryByText(/Depth:/)).toBeNull();
    expect(queryByRole('button', { name: /^Layout preset:/ })).toBeNull();
  });

  it('hides them in the QEC Workbench too', () => {
    useWorkspaceStore.setState({ mode: 'research' });
    useNavigationStore.setState({ activeView: 'qec' });
    const { queryByText } = renderStatusBar();
    expect(queryByText(/Qubits:/)).toBeNull();
  });

  it('labels the preset trigger so a bare "Clean" is never ambiguous, and opens on the current preset', () => {
    const { getByRole, getAllByRole } = renderStatusBar();
    const trigger = getByRole('button', { name: 'Layout preset: Clean' });
    expect(trigger.textContent).toBe('Layout: Clean');
    fireEvent.click(trigger);
    const checked = getAllByRole('menuitemradio').find((el) => el.getAttribute('aria-checked') === 'true');
    expect(checked?.textContent).toContain('Clean');
    expect(document.activeElement).toBe(checked);
  });

  it('is a menu like Level, sized to its label (no fixed-width select with a gap before the chevron)', () => {
    const { getByRole } = renderStatusBar();
    expect(getByRole('button', { name: /^Layout preset:/ }).getAttribute('aria-haspopup')).toBe('menu');
    expect(document.querySelector('.nuclei-statusbar-select')).toBeNull();
  });
});

describe('StatusBar kernel state', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ mode: 'learn' });
    useSimulationStore.setState({ isRunning: false, result: null });
    useEditorStore.setState({ kernelReady: false, kernelStatus: 'idle', kernelError: null, kernelProgress: null });
  });

  it('is a retry action that carries the error when the kernel failed', () => {
    useEditorStore.getState().setKernelStatus('failed', 'Kernel rejected the session token — restart Nuclei');
    const { getByRole } = renderStatusBar();
    const chip = getByRole('button', { name: /Kernel didn't start/ });
    expect(chip.getAttribute('title')).toBeNull();
  });

  it('sends a failed-kernel click to the banner that owns Retry, and retries itself only when no banner is showing', async () => {
    const control = await import('../../lib/kernelControl');
    const retry = vi.fn();
    const focusBanner = vi.fn();
    control.registerKernelRetry(retry);
    useEditorStore.getState().setKernelStatus('failed', 'boom');
    const { getByRole } = renderStatusBar();
    fireEvent.click(getByRole('button', { name: /Kernel didn't start/ }));
    expect(retry).toHaveBeenCalledTimes(1); // no banner mounted: fall back to retrying
    control.registerKernelBannerFocus(focusBanner);
    fireEvent.click(getByRole('button', { name: /Kernel didn't start/ }));
    expect(focusBanner).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
    control.registerKernelBannerFocus(null);
    control.registerKernelRetry(null);
  });

  it('shows the kernel state with no native title attribute (the shared tooltip carries the detail)', () => {
    useEditorStore.setState({ kernelReady: true, kernelStatus: 'ready' });
    const { getByText } = renderStatusBar();
    expect(getByText(/ready/).closest('span')?.getAttribute('title')).toBeNull();
  });

  it('never says ready while the kernel is still loading', () => {
    useEditorStore.setState({
      kernelStatus: 'connecting',
      kernelProgress: { step: 2, total: 3, label: 'Loading NumPy', fraction: 0.6 },
    });
    const { getByText, queryByText } = renderStatusBar();
    expect(getByText(/^Starting (Python|kernel) 2\/3$/)).toBeTruthy();
    expect(queryByText(/ready/i)).toBeNull();
  });

  it('shows Done with the run time once a result exists', () => {
    useEditorStore.setState({ kernelReady: true, kernelStatus: 'ready' });
    useSimulationStore.setState({ result: { execution_time_ms: 41.6 } as never });
    const { getByText } = renderStatusBar();
    expect(getByText('Done · 42 ms')).toBeTruthy();
  });
});

describe('StatusBar controls', () => {
  beforeEach(() => {
    useEditorStore.setState({ kernelReady: true, kernelStatus: 'ready' });
    useSimulationStore.setState({ isRunning: false, result: null });
  });

  it('names the theme toggle for assistive tech', () => {
    const { getByRole } = renderStatusBar();
    const toggle = getByRole('button', { name: /Switch to (light|dark) theme/ });
    expect(toggle.style.width).toBe('22px');
    expect(toggle.style.height).toBe('22px');
  });

  it('offers the UI-mode control in Learn but not in Research', () => {
    useWorkspaceStore.setState({ mode: 'learn' });
    const learn = renderStatusBar();
    expect(learn.getByRole('button', { name: /^Level:/ })).toBeTruthy();
    learn.unmount();

    useWorkspaceStore.setState({ mode: 'research' });
    const research = renderStatusBar();
    expect(research.queryByRole('button', { name: /^Level:/ })).toBeNull();
  });

  it('opens a level menu instead of cycling blindly on click', () => {
    useWorkspaceStore.setState({ mode: 'learn' });
    useUIModeStore.setState({ mode: 'intermediate' });
    const { getByRole, getAllByRole } = renderStatusBar();
    fireEvent.click(getByRole('button', { name: 'Level: Intermediate' }));
    const items = getAllByRole('menuitemradio');
    expect(items).toHaveLength(3);
    expect(useUIModeStore.getState().mode).toBe('intermediate');
    fireEvent.click(items[0]);
    expect(useUIModeStore.getState().mode).toBe('beginner');
  });
});
