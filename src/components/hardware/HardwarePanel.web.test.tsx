// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { HardwarePanel } from './HardwarePanel';
import { PlatformProvider } from '../../platform/PlatformProvider';
import type { PlatformBridge } from '../../platform/bridge';
import { useEditorStore } from '../../stores/editorStore';

vi.mock('../../App', () => ({ getHardware: () => null, getExecute: () => null }));

const web = { getPlatform: () => 'web' } as unknown as PlatformBridge;

afterEach(cleanup);

describe('HardwarePanel on the web build (rq-r3-13)', () => {
  it('says the simulator runs in the browser and keeps Desktop app for real providers', () => {
    render(<PlatformProvider bridge={web}><HardwarePanel /></PlatformProvider>);
    const simulatorRow = screen.getByText('Local Simulator').parentElement?.parentElement as HTMLElement;
    expect(within(simulatorRow).getByText('In your browser')).toBeTruthy();
    expect(within(simulatorRow).queryByText('Desktop app')).toBeNull();
    const ibmRow = screen.getByText('IBM Quantum').parentElement?.parentElement as HTMLElement;
    expect(within(ibmRow).getByText('Desktop app')).toBeTruthy();
  });

  it('lists the one working provider, Local Simulator, first', () => {
    render(<PlatformProvider bridge={web}><HardwarePanel /></PlatformProvider>);
    const sim = screen.getByText('Local Simulator');
    const ibm = screen.getByText('IBM Quantum');
    expect(sim.compareDocumentPosition(ibm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('uses the shared desktop-only state with one Download action', () => {
    render(<PlatformProvider bridge={web}><HardwarePanel /></PlatformProvider>);
    expect(screen.getByText('Hardware runs need the desktop app').className).toContain('nuclei-empty__title');
    expect(screen.getAllByRole('button', { name: 'Download Nuclei' })).toHaveLength(1);
  });
});

describe('HardwarePanel on desktop (research-r-04)', () => {
  const desktop = { getPlatform: () => 'desktop' } as unknown as PlatformBridge;
  afterEach(() => useEditorStore.setState({ kernelStatus: 'idle' }));

  it("does not call the Local Simulator Ready when the kernel didn't start, and offers Retry", () => {
    useEditorStore.setState({ kernelStatus: 'failed' });
    render(<PlatformProvider bridge={desktop}><HardwarePanel /></PlatformProvider>);
    const row = screen.getByText('Local Simulator').parentElement?.parentElement as HTMLElement;
    expect(within(row).getByText("Kernel didn't start")).toBeTruthy();
    expect(within(row).queryByText('Ready')).toBeNull();
    expect(within(row).getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('keeps the provider name readable first: wraps the status instead of truncating the name, and offers a Configure icon', () => {
    render(<PlatformProvider bridge={desktop}><HardwarePanel /></PlatformProvider>);
    const row = screen.getByText('IBM Quantum').parentElement?.parentElement as HTMLElement;
    expect(row.style.flexWrap).toBe('wrap');
    expect((screen.getByText('IBM Quantum').parentElement as HTMLElement).style.minWidth).toBe('11ch');
    expect(within(row).getByRole('button', { name: 'Configure IBM Quantum' })).toBeTruthy();
  });
});
