// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { LaunchModal } from './LaunchModal';
import { PlatformProvider } from '../../platform/PlatformProvider';
import type { PlatformBridge } from '../../platform/bridge';
import { useHardwareStore } from '../../stores/hardwareStore';
import { useEditorStore } from '../../stores/editorStore';

const mockExecute = vi.fn();
const mockHardware = {
  hardwareConnect: vi.fn(),
  hardwareSubmit: vi.fn(() => true),
  hardwareCancel: vi.fn(),
  hardwareDismiss: vi.fn(),
};
vi.mock('../../App', () => ({ getHardware: () => mockHardware, getExecute: () => mockExecute }));

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
    expect(screen.getByLabelText('IBM Quantum API token')).toBeTruthy();
    expect(screen.queryByText(/Connect your IBM Quantum account/)).toBeNull();
    expect(screen.queryByText(/jobs ahead/)).toBeNull();
  });

  it('disables the Local Simulator card while the kernel is starting', () => {
    useEditorStore.setState({ kernelStatus: 'connecting' });
    mount('desktop');
    const card = document.querySelector('[data-provider="simulator"]') as HTMLButtonElement;
    expect(card.disabled).toBe(true);
    expect(card.textContent).toMatch(/Starting/);
    useEditorStore.setState({ kernelStatus: 'idle' });
  });

  it('never says kernel on the web launch step', () => {
    useHardwareStore.setState({ selectedProvider: 'ibm' });
    mount('web');
    expect(document.body.textContent ?? '').toMatch(/need the desktop app/);
    expect(document.body.textContent ?? '').not.toMatch(/kernel/i);
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

  it('badges hardware providers Desktop app on the web build as inert cards (no dead-end step)', () => {
    mount('web');
    expect(screen.getAllByText('Desktop app').length).toBeGreaterThanOrEqual(6);
    const ibm = document.querySelector<HTMLButtonElement>('[data-provider="ibm"]');
    expect(ibm?.disabled).toBe(true);
    fireEvent.click(screen.getByText('IBM Quantum'));
    expect(useHardwareStore.getState().selectedProvider).toBeNull();
    expect(screen.getByRole('button', { name: /Download Nuclei/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Launch' })).toBeNull();
  });

  it('on the web build opens with focus on the one card that works, not the Download button', () => {
    mount('web');
    expect(document.activeElement).toBe(document.querySelector('[data-provider="simulator"]'));
  });

  it('on the web build the Local Simulator says Run here, closes the dialog and runs', () => {
    mount('web');
    expect(screen.getAllByText('Run here').length).toBe(1);
    fireEvent.click(screen.getByText('Local Simulator'));
    expect(useHardwareStore.getState().launchOpen).toBe(false);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockHardware.hardwareSubmit).not.toHaveBeenCalled();
  });

  it('leads with the Local Simulator and keeps coming-soon providers last', () => {
    mount('desktop');
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-provider]')).map((el) => el.dataset.provider);
    expect(cards[0]).toBe('simulator');
    expect(cards.slice(-3).sort()).toEqual(['dwave', 'google', 'xanadu']);
  });

  it('keeps the dialog anchored to the top so it does not re-centre between steps', () => {
    mount('desktop');
    expect(screen.getByTestId('dialog-scrim').className).toContain('nuclei-dialog-scrim--top');
  });

  it('shows only the setup card until a multi-credential provider connects (rq-r3-08)', () => {
    mount('desktop');
    fireEvent.click(screen.getByText('AWS Braket'));
    expect(screen.getByRole('button', { name: 'Set up AWS Braket' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Launch' })).toBeNull();
    expect(screen.queryByLabelText('Shots')).toBeNull();
    expect(screen.queryByRole('button', { name: 'IonQ' })).toBeNull();
    expect(screen.queryByText(/Connect your AWS Braket account/)).toBeNull();
  });

  it('reveals the filter chips, backends and shots once the provider is connected', () => {
    useHardwareStore.getState().setProviderConnected('braket', true);
    mount('desktop');
    fireEvent.click(screen.getByText('AWS Braket'));
    expect(screen.getByRole('button', { name: 'IonQ' })).toBeTruthy();
    expect(screen.getByLabelText('Shots')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Launch' })).toBeTruthy();
  });

  it('moves keyboard focus into step two for a provider that needs the credential form (rq-r3-09)', async () => {
    mount('desktop');
    fireEvent.click(screen.getByText('AWS Braket'));
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    expect(document.activeElement?.textContent).toContain('Set up AWS Braket');
    expect(document.activeElement?.hasAttribute('data-launch-focus')).toBe(true);
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

  it('closes the dialog when the scrim is pressed, even on the backend step', () => {
    mount('desktop');
    fireEvent.click(screen.getByText('IonQ'));
    fireEvent.mouseDown(screen.getByTestId('dialog-scrim'));
    expect(useHardwareStore.getState().launchOpen).toBe(false);
  });

  it('offers the desktop download on the first step of the web build', () => {
    mount('web');
    expect(screen.getByRole('button', { name: /Download Nuclei/ })).toBeTruthy();
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
