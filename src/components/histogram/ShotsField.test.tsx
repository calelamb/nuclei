// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react';
import { ShotsField } from './ShotsField';
import { useSimulationStore } from '../../stores/simulationStore';
import { useSettingsStore } from '../../stores/settingsStore';

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

  it('clamps on blur and explains why', () => {
    render(<ShotsField />);
    const input = screen.getByLabelText('Shots') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.blur(input);
    expect(useSimulationStore.getState().shots).toBe(100);
    expect(screen.getByRole('status').textContent).toMatch(/Minimum is 100/);
  });

  it('follows a change made elsewhere', () => {
    render(<ShotsField />);
    act(() => useSimulationStore.getState().setShots(4096));
    expect((screen.getByLabelText('Shots') as HTMLInputElement).value).toBe('4,096');
  });
});
