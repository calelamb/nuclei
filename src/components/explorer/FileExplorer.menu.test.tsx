// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FileExplorer } from './FileExplorer';
import { PlatformProvider } from '../../platform/PlatformProvider';
import { useProjectStore } from '../../stores/projectStore';
import type { PlatformBridge } from '../../platform/PlatformProvider';

const bridge = {
  getPlatform: () => 'desktop',
  listDirectory: vi.fn(async () => []),
  getStoredValue: vi.fn(async () => null),
  setStoredValue: vi.fn(async () => undefined),
} as unknown as PlatformBridge;

function setup() {
  useProjectStore.setState({ projectRoot: 'memory://demo' });
  render(<PlatformProvider bridge={bridge}><FileExplorer /></PlatformProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'New file, circuit or folder' }));
}

afterEach(cleanup);

describe('FileExplorer New menu', () => {
  it('opens the circuit list only on click, not on hover', () => {
    setup();
    const circuit = screen.getByRole('button', { name: /New Circuit/ });
    fireEvent.mouseEnter(circuit.parentElement as HTMLElement);
    fireEvent.mouseOver(circuit);
    expect(screen.queryByRole('button', { name: 'Cirq' })).toBeNull();
    fireEvent.click(circuit);
    expect(circuit.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: /Cirq/ })).toBeTruthy();
    fireEvent.click(circuit);
    expect(screen.queryByRole('button', { name: /Cirq/ })).toBeNull();
  });

  it('closes on Escape', () => {
    setup();
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
