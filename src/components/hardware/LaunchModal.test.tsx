// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { LaunchModal } from './LaunchModal';
import { PlatformProvider } from '../../platform/PlatformProvider';
import type { PlatformBridge } from '../../platform/bridge';
import { useHardwareStore } from '../../stores/hardwareStore';
import { useEditorStore } from '../../stores/editorStore';

const mockHardware = {
  hardwareConnect: vi.fn(),
  hardwareSubmit: vi.fn(() => true),
  hardwareCancel: vi.fn(),
  hardwareDismiss: vi.fn(),
};
vi.mock('../../App', () => ({ getHardware: () => mockHardware }));

const bridge = (platform: 'web' | 'desktop') => ({ getPlatform: () => platform }) as unknown as PlatformBridge;

function mount(platform: 'web' | 'desktop') {
  return render(
    <PlatformProvider bridge={bridge(platform)}>
      <LaunchModal />
    </PlatformProvider>,
  );
}

const baseState = {
  launchOpen: true,
  selectedProvider: null,
  selectedSubProvider: null,
  selectedBackend: null,
  backends: [],
  connectionErrors: {},
  connectingProvider: null,
  stagedSubmission: null,
};

describe('LaunchModal honesty', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.setState({ code: 'qc = 1', framework: 'qiskit' });
    useHardwareStore.setState({
      ...baseState,
      providers: useHardwareStore.getState().providers.map((p) => ({ ...p, connected: p.name === 'simulator' })),
    });
  });
  afterEach(cleanup);

  it('never lists invented backends: with nothing live the IBM step asks for a connection', () => {
    mount('desktop');
    fireEvent.click(screen.getByText('IBM Quantum'));
    expect(screen.queryByText('ibm_brisbane')).toBeNull();
    expect(screen.getByText(/Connect your IBM Quantum account/)).toBeTruthy();
    expect(screen.queryByText(/jobs ahead/)).toBeNull();
  });

  it('lists only the backends the kernel reported', () => {
    useHardwareStore.setState({
      backends: [{ name: 'ibm_real', provider: 'ibm', qubitCount: 133, connectivity: [], queueLength: 2, averageErrorRate: 0.0021, gateSet: ['CZ'], status: 'online' }],
    });
    useHardwareStore.getState().setProviderConnected('ibm', true);
    mount('desktop');
    fireEvent.click(screen.getByText('IBM Quantum'));
    expect(screen.getByText('ibm_real')).toBeTruthy();
    expect(screen.getByText('err 0.21%')).toBeTruthy();
    expect(screen.getByText('2 jobs ahead')).toBeTruthy();
  });

  it('badges every provider Desktop app on the web build and offers a download instead of Launch', () => {
    mount('web');
    expect(screen.getAllByText('Desktop app').length).toBeGreaterThanOrEqual(7);
    fireEvent.click(screen.getByText('Local Simulator'));
    expect(screen.getByRole('button', { name: /Download Nuclei to launch/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Launch' })).toBeNull();
  });

  it('renders a connection error for providers that have no token field', () => {
    useHardwareStore.setState({ connectionErrors: { nvidia: 'CUDA-Q is not installed in this environment.' } });
    mount('desktop');
    fireEvent.click(screen.getByText('NVIDIA CUDA-Q'));
    expect(screen.getByRole('alert').textContent).toContain('CUDA-Q is not installed');
  });

  it('connects account-free providers through the kernel when they are chosen', () => {
    mount('desktop');
    fireEvent.click(screen.getByText('NVIDIA CUDA-Q'));
    expect(mockHardware.hardwareConnect).toHaveBeenCalledWith('nvidia', {});
  });

  it('treats Escape on the backend step as Back, and Escape on the first step as close', () => {
    mount('desktop');
    fireEvent.click(screen.getByText('IonQ'));
    expect(useHardwareStore.getState().selectedProvider).toBe('ionq');
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(useHardwareStore.getState().selectedProvider).toBeNull();
    expect(useHardwareStore.getState().launchOpen).toBe(true);
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(useHardwareStore.getState().launchOpen).toBe(false);
  });

  it('keeps keyboard focus inside the dialog after choosing a provider', async () => {
    mount('desktop');
    fireEvent.click(screen.getByText('IBM Quantum'));
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    expect(document.activeElement?.id).toBe('launch-token-input');
  });

  it('sends multi-field providers to the credential form instead of a dead end', () => {
    mount('desktop');
    fireEvent.click(screen.getByText('AWS Braket'));
    fireEvent.click(screen.getByRole('button', { name: 'Set up AWS Braket' }));
    expect(useHardwareStore.getState().launchOpen).toBe(false);
    expect(useHardwareStore.getState().showCredentialSetup).toBe('braket');
  });
});
