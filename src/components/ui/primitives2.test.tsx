// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Checkbox } from './Checkbox';
import { Tabs } from './Tabs';
import { Badge } from './Badge';

afterEach(cleanup);

describe('Checkbox', () => {
  it('reports the next value on click and is labelled', () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={onCheckedChange} label="Show hints" />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show hints' }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('exposes the mixed state and sets the DOM indeterminate flag', () => {
    render(<Checkbox checked={false} indeterminate onCheckedChange={() => undefined} aria-label="All" />);
    const el = screen.getByRole('checkbox', { name: 'All' }) as HTMLInputElement;
    expect(el.indeterminate).toBe(true);
    expect(el.getAttribute('aria-checked')).toBe('mixed');
  });

  it('does not fire when disabled', () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox checked disabled onCheckedChange={onCheckedChange} aria-label="x" />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState('a');
  return (
    <Tabs
      aria-label="Sections"
      value={v}
      onChange={(n) => { setV(n); onChange?.(n); }}
      options={[{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta', disabled: true }, { value: 'c', label: 'Gamma' }]}
    />
  );
}

describe('Tabs', () => {
  it('marks the active tab selected with a roving tab stop', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'Alpha' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Alpha' }).tabIndex).toBe(0);
    expect(screen.getByRole('tab', { name: 'Gamma' }).tabIndex).toBe(-1);
  });

  it('arrow keys skip disabled tabs and wrap; Home/End jump', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const list = screen.getByRole('tablist');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(list, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(list, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith('a');
  });

  it('clicking selects', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Gamma' }));
    expect(onChange).toHaveBeenCalledWith('c');
  });
});

describe('Badge', () => {
  it('renders children with the tone class', () => {
    render(<Badge tone="success">Ready</Badge>);
    expect(screen.getByText('Ready').className).toContain('nuclei-badge--success');
  });
});

describe('Tabs overflow cue', () => {
  it('flags a clipped end edge so the strip can fade it', async () => {
    const rect = { scrollWidth: 400, clientWidth: 200, scrollLeft: 0 };
    const spies = (Object.keys(rect) as Array<keyof typeof rect>).map((k) =>
      vi.spyOn(HTMLElement.prototype, k, 'get').mockReturnValue(rect[k]));
    render(<Harness />);
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    expect(screen.getByRole('tablist').getAttribute('data-overflow')).toBe('end');
    spies.forEach((s) => s.mockRestore());
  });

  it('reports no overflow when everything fits', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist').getAttribute('data-overflow')).toBe('none');
  });
});
