// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LabButton, LabDrawer, LabEmptyState, LabMeter, LabNumber, LabSegmented } from './primitives';

afterEach(cleanup);

describe('LabSegmented', () => {
  const items = [
    { id: 'a' as const, label: 'Alpha' },
    { id: 'b' as const, label: 'Beta', badge: 3 },
    { id: 'c' as const, label: 'Gamma', disabled: true },
  ];

  it('exposes tab semantics with roving tabindex', () => {
    render(<LabSegmented items={items} value="a" onChange={() => {}} label="Views" />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[1].tabIndex).toBe(-1);
  });

  it('moves selection with arrow keys, skipping disabled tabs', () => {
    const onChange = vi.fn();
    render(<LabSegmented items={items} value="b" onChange={onChange} label="Views" />);
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('a');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('b');
  });
});

describe('LabNumber', () => {
  it('commits clamped integers on blur and ignores garbage', () => {
    const onCommit = vi.fn();
    render(<LabNumber value={10} onCommit={onCommit} min={1} max={50} aria-label="Samples" />);
    const input = screen.getByLabelText('Samples') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(50);
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(input.value).toBe('10');
  });
});

describe('LabMeter', () => {
  it('reports value against max for assistive tech', () => {
    render(<LabMeter label="Evaluations" value={42} max={200} />);
    const meter = screen.getByRole('meter', { name: 'Evaluations' });
    expect(meter.getAttribute('aria-valuenow')).toBe('42');
    expect(meter.getAttribute('aria-valuemax')).toBe('200');
  });
});

describe('LabDrawer', () => {
  it('renders a modal dialog and closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <LabDrawer open onClose={onClose} title="Candidate c-0007" label="Candidate detail">
        body
      </LabDrawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Candidate detail' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(
      <LabDrawer open={false} onClose={() => {}} title="x" label="Candidate detail">
        body
      </LabDrawer>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('LabEmptyState + LabButton', () => {
  it('never renders a blank box', () => {
    render(<LabEmptyState title="No runs yet" body="Start one." actions={<LabButton>Start</LabButton>} />);
    expect(screen.getByText('No runs yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
  });
});
