// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import { ShotsField } from './ShotsField';
import { useSimulationStore } from '../../stores/simulationStore';
import { useSettingsStore } from '../../stores/settingsStore';

/**
 * Types like a person: each character replaces whatever is selected, then the caret moves after it.
 * fireEvent.change replaces the whole value, which is how the append bug survived; this does not.
 */
function typeText(input: HTMLInputElement, text: string) {
  for (const ch of text) {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const next = input.value.slice(0, start) + ch + input.value.slice(end);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, next);
    input.setSelectionRange(start + 1, start + 1);
    fireEvent.input(input);
  }
}

function focusLikeAPerson(input: HTMLInputElement) {
  act(() => { input.focus(); });
}

afterEach(() => {
  cleanup();
  useSimulationStore.getState().setShots(1024);
  useSettingsStore.getState().updateKernel({ defaultShots: 1024 });
});

describe('<ShotsField>', () => {
  it('lets the whole value be retyped and commits on Enter to both stores', () => {
    render(<ShotsField />);
    const input = screen.getByLabelText('Shots') as HTMLInputElement;
    expect(input.value).toBe('1,024');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: '2048' } });
    expect(useSimulationStore.getState().shots).toBe(1024);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useSimulationStore.getState().shots).toBe(2048);
    expect(useSettingsStore.getState().kernel.defaultShots).toBe(2048);
    expect(input.value).toBe('2,048');
  });

  it('typing after focusing replaces the whole value (select on focus survives the re-render)', () => {
    render(<ShotsField />);
    const input = screen.getByLabelText('Shots') as HTMLInputElement;
    focusLikeAPerson(input);
    typeText(input, '2048');
    expect(input.value).toBe('2048');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useSimulationStore.getState().shots).toBe(2048);
    expect(useSettingsStore.getState().kernel.defaultShots).toBe(2048);
    expect(input.value).toBe('2,048');
  });

  it('never writes a clamped typo to the shots setting or Default shots', () => {
    render(<ShotsField />);
    const input = screen.getByLabelText('Shots') as HTMLInputElement;
    // Caret placed at the end (no selection) and the digits appended: 1024 + 2048.
    focusLikeAPerson(input);
    input.setSelectionRange(input.value.length, input.value.length);
    typeText(input, '2048');
    expect(input.value).toBe('10242048');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useSimulationStore.getState().shots).toBe(1024);
    expect(useSettingsStore.getState().kernel.defaultShots).toBe(1024);
    expect(screen.getByRole('status').textContent).toMatch(/Maximum is 100,000/);
    // Still focused: the kept value is shown plain and selected so the correction replaces it.
    expect(input.value).toBe('1024');
    act(() => { input.blur(); });
    expect(input.value).toBe('1,024');
  });

  it('keeps the previous value for a too-small number and explains why', () => {
    render(<ShotsField />);
    const input = screen.getByLabelText('Shots') as HTMLInputElement;
    focusLikeAPerson(input);
    typeText(input, '50');
    act(() => { input.blur(); });
    expect(useSimulationStore.getState().shots).toBe(1024);
    expect(useSettingsStore.getState().kernel.defaultShots).toBe(1024);
    expect(screen.getByRole('status').textContent).toMatch(/Minimum is 100/);
  });

  it('has no native title (the hint slot carries the range)', () => {
    render(<ShotsField />);
    expect(screen.getByLabelText('Shots').getAttribute('title')).toBeNull();
  });

  it('follows a change made elsewhere', () => {
    render(<ShotsField />);
    act(() => useSimulationStore.getState().setShots(4096));
    expect((screen.getByLabelText('Shots') as HTMLInputElement).value).toBe('4,096');
  });

  it('re-editing a committed, grouped value keeps what was typed', () => {
    render(<ShotsField />);
    const input = screen.getByLabelText('Shots') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '2048' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: '2,049' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useSimulationStore.getState().shots).toBe(2049);
    expect(useSettingsStore.getState().kernel.defaultShots).toBe(2049);
  });

  it('clears the clamp hint when the field is focused again', () => {
    render(<ShotsField />);
    const input = screen.getByLabelText('Shots') as HTMLInputElement;
    focusLikeAPerson(input);
    typeText(input, '5');
    act(() => { input.blur(); });
    expect(screen.getByRole('status').textContent).toMatch(/Minimum/);
    focusLikeAPerson(input);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('after a rejected Enter the kept value is selected so the next keystrokes replace it', () => {
    useSimulationStore.getState().setShots(2048);
    render(<ShotsField />);
    const input = screen.getByLabelText('Shots') as HTMLInputElement;
    focusLikeAPerson(input);
    typeText(input, '50');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('status').textContent).toMatch(/Minimum is 100/);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    typeText(input, '500');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useSimulationStore.getState().shots).toBe(500);
  });

  it('keeps the selection through the mouseup that follows a click-to-focus (WebKit collapses it otherwise)', () => {
    render(<ShotsField />);
    const input = screen.getByLabelText('Shots') as HTMLInputElement;
    focusLikeAPerson(input);
    const notPrevented = fireEvent.mouseUp(input);
    expect(notPrevented).toBe(false);
    // Only the first mouseup after focus is swallowed; later clicks place the caret normally.
    expect(fireEvent.mouseUp(input)).toBe(true);
  });
});
