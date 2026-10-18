// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BackendSelector } from './BackendSelector';
import type { BackendInfo } from '../../types/hardware';

const backends = [
  { name: 'statevector', provider: 'simulator', status: 'online', qubitCount: 24, queueLength: 0 },
  { name: 'ibm_brisbane', provider: 'ibm', status: 'maintenance', qubitCount: 127, queueLength: 9 },
] as unknown as BackendInfo[];

afterEach(cleanup);

function mount(onSelect = vi.fn(), onKeyDownOutside = vi.fn()) {
  render(
    <div onKeyDown={onKeyDownOutside}>
      <span id="lbl">Backend</span>
      <BackendSelector labelledBy="lbl" backends={backends} selected="statevector" onSelect={onSelect} />
    </div>,
  );
  return { onSelect, onKeyDownOutside };
}

describe('BackendSelector (interaction-r-08)', () => {
  it('is a menu button named by its label and current value', () => {
    mount();
    const trigger = screen.getByRole('button', { name: 'Backend statevector' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on the current backend, arrows move, Enter selects', () => {
    const { onSelect } = mount();
    const trigger = screen.getByRole('button', { name: 'Backend statevector' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('menuitemradio');
    expect(items[0].getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.click(items[1]);
    expect(onSelect).toHaveBeenCalledWith('ibm_brisbane');
  });

  it('Escape closes only the menu, returns focus to the trigger and does not reach the form', () => {
    const { onKeyDownOutside } = mount();
    const trigger = screen.getByRole('button', { name: 'Backend statevector' });
    fireEvent.click(trigger);
    const first = screen.getAllByRole('menuitemradio')[0];
    const notPrevented = fireEvent.keyDown(first, { key: 'Escape' });
    expect(notPrevented).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onKeyDownOutside).toHaveBeenCalled();
  });

  it('says so when there are no backends', () => {
    render(<BackendSelector backends={[]} selected={null} onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Backend' }));
    expect(screen.getByText('No backends available')).toBeTruthy();
  });
});
