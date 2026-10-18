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
    const circuit = screen.getByRole('menuitem', { name: /New circuit/ });
    fireEvent.mouseEnter(circuit.parentElement as HTMLElement);
    fireEvent.mouseOver(circuit);
    expect(screen.queryByRole('menuitem', { name: 'Cirq' })).toBeNull();
    fireEvent.click(circuit);
    expect(circuit.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menuitem', { name: /Cirq/ })).toBeTruthy();
    fireEvent.click(circuit);
    expect(screen.queryByRole('menuitem', { name: /Cirq/ })).toBeNull();
  });

  it('closes on Escape', () => {
    setup();
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('is operable from the keyboard: focus lands on the first item and arrows rove', () => {
    setup();
    const items = screen.getAllByRole('menuitem');
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
  });

  it('expands New circuit with ArrowRight and picks a framework by keyboard', () => {
    setup();
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowRight' });
    expect(document.activeElement?.textContent).toMatch(/Qiskit/);
    fireEvent.click(document.activeElement as HTMLElement);
    expect(screen.queryByRole('menu')).toBeNull();
    expect((screen.getByPlaceholderText(/\.py$/) as HTMLInputElement).value).toMatch(/\.py$/);
  });

  it('writes every entry in sentence case (rq-r3-11)', () => {
    setup();
    const labels = screen.getAllByRole('menuitem').map((item) => item.textContent?.replace(/\.\w+$/, '').trim());
    expect(labels).toEqual(expect.arrayContaining(['New file', 'New circuit', 'New Python package', 'New folder']));
    expect(labels.join(' ')).not.toMatch(/New (File|Circuit|Folder|Package)/);
  });
});
