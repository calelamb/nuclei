// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FileExplorer } from './FileExplorer';
import { baseNameSelectionEnd } from './nameInputSelection';
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
  useProjectStore.setState({ projectRoot: 'memory://demo', tabs: [] });
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

describe('FileExplorer new-file name input (research-r-01)', () => {
  function startNewFile() {
    setup();
    fireEvent.click(screen.getByRole('menuitem', { name: /New file/ }));
    return screen.getByRole('textbox', { name: /name/i }) as HTMLInputElement;
  }
  const tabPaths = () => useProjectStore.getState().tabs.map((t) => t.path);

  it('selects the base name and keeps the extension', () => {
    const input = startNewFile();
    expect(input.value).toBe('untitled.py');
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 8]);
    expect(document.activeElement).toBe(input);
  });

  it('typing replaces the base name: analysis becomes analysis.py', () => {
    const input = startNewFile();
    const next = input.value.slice(0, input.selectionStart ?? 0) + 'analysis' + input.value.slice(input.selectionEnd ?? 0);
    fireEvent.change(input, { target: { value: next } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(tabPaths()).toContain('memory://demo/analysis.py');
  });

  it('appends .py when the typed name has no extension', () => {
    const input = startNewFile();
    fireEvent.change(input, { target: { value: 'notes' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(tabPaths()).toContain('memory://demo/notes.py');
  });

  it('selects whole names for folders and dotfiles', () => {
    expect(baseNameSelectionEnd('new_folder')).toBe(10);
    expect(baseNameSelectionEnd('.env')).toBe(4);
    expect(baseNameSelectionEnd('a.b.py')).toBe(3);
  });
});
