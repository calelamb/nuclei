// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Menu, type MenuEntry } from './Menu';

afterEach(cleanup);

function setup(entries: MenuEntry[], extra: Partial<React.ComponentProps<typeof Menu>> = {}) {
  render(
    <Menu
      label="File actions"
      entries={entries}
      trigger={(p) => <button {...p}>Actions</button>}
      {...extra}
    />,
  );
  return screen.getByText('Actions');
}

const basic = (onA = vi.fn(), onB = vi.fn()): MenuEntry[] => [
  { id: 'a', label: 'Alpha', onSelect: onA },
  { id: 'b', label: 'Beta', onSelect: onB },
  { id: 'c', label: 'Gamma', disabled: true },
  { id: 'd', label: 'Delta' },
];

describe('Menu', () => {
  it('marks the trigger as a menu popup and reflects open state', () => {
    const trigger = setup(basic());
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'File actions' })).toBeTruthy();
  });

  it('focuses the first item on open and roves with arrow keys, skipping disabled items', () => {
    const trigger = setup(basic());
    fireEvent.click(trigger);
    expect(screen.getAllByRole('menuitem').length).toBe(4);
    expect(document.activeElement?.textContent).toBe('Alpha');
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Beta');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Delta');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement?.textContent).toBe('Alpha');
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement?.textContent).toBe('Delta');
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement?.textContent).toBe('Alpha');
  });

  it('opens from the keyboard with ArrowDown on the trigger', () => {
    const trigger = setup(basic());
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const trigger = setup(basic());
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('selecting an item runs it, closes the menu and returns focus to the trigger', () => {
    const onB = vi.fn();
    const trigger = setup(basic(vi.fn(), onB));
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText('Beta'));
    expect(onB).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('does not run disabled items', () => {
    const onSelect = vi.fn();
    const trigger = setup([{ id: 'x', label: 'Nope', disabled: true, onSelect }]);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText('Nope'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes on an outside press', () => {
    const trigger = setup(basic());
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('exposes checkable items as menuitemradio with aria-checked', () => {
    const trigger = setup([
      { id: 'q', label: 'Qiskit', checked: true },
      { id: 'c', label: 'Cirq', checked: false },
    ]);
    fireEvent.click(trigger);
    const radios = screen.getAllByRole('menuitemradio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false']);
  });

  it('expands a submenu with ArrowRight and collapses it with ArrowLeft', () => {
    const trigger = setup([
      { id: 'file', label: 'New File' },
      { id: 'circuit', label: 'New Circuit', items: [{ id: 'qiskit', label: 'Qiskit' }, { id: 'cirq', label: 'Cirq' }] },
    ]);
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    const parent = document.activeElement as HTMLElement;
    expect(parent.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(menu, { key: 'ArrowRight' });
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.textContent).toBe('Qiskit');
    fireEvent.keyDown(menu, { key: 'ArrowLeft' });
    expect(parent.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(parent);
  });

  it('renders headings and separators without making them focusable items', () => {
    const trigger = setup([
      { id: 'h', heading: 'Framework' },
      { id: 'a', label: 'One' },
      { id: 's', separator: true },
      { id: 'b', label: 'Two' },
    ]);
    fireEvent.click(trigger);
    expect(screen.getAllByRole('menuitem').length).toBe(2);
    expect(screen.getByText('Framework')).toBeTruthy();
    expect(screen.getByRole('separator')).toBeTruthy();
  });

  it('shows a notice slot as a status message', () => {
    const trigger = setup(basic(), { notice: 'Copied' });
    fireEvent.click(trigger);
    expect(screen.getByRole('status').textContent).toBe('Copied');
  });
});
