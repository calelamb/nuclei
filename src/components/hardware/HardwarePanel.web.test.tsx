// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { HardwarePanel } from './HardwarePanel';
import { PlatformProvider } from '../../platform/PlatformProvider';
import type { PlatformBridge } from '../../platform/bridge';

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

  it('uses the shared desktop-only state with one Download action', () => {
    render(<PlatformProvider bridge={web}><HardwarePanel /></PlatformProvider>);
    expect(screen.getByText('Hardware runs need the desktop app').className).toContain('nuclei-empty__title');
    expect(screen.getAllByRole('button', { name: 'Download Nuclei' })).toHaveLength(1);
  });
});
