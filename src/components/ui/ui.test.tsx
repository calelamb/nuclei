// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Select } from './Select';
import { TextInput, TextArea } from './TextInput';
import { Switch } from './Switch';
import { ChoiceCard } from './ChoiceCard';

afterEach(cleanup);

describe('Button', () => {
  it('defaults to type=button, secondary, md', () => {
    render(<Button>Save</Button>);
    const el = screen.getByRole('button', { name: 'Save' });
    expect(el.getAttribute('type')).toBe('button');
    expect(el.className).toContain('nuclei-btn--secondary');
    expect(el.className).toContain('nuclei-btn--md');
  });

  it('applies variant and size classes', () => {
    render(<Button variant="danger" size="sm">Delete</Button>);
    const el = screen.getByRole('button', { name: 'Delete' });
    expect(el.className).toContain('nuclei-btn--danger');
    expect(el.className).toContain('nuclei-btn--sm');
  });

  it('stays focusable while loading (aria-disabled, not disabled), is busy, and ignores clicks', () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Retry</Button>);
    const el = screen.getByRole('button', { name: /Retry/ }) as HTMLButtonElement;
    expect(el.disabled).toBe(false);
    expect(el.getAttribute('aria-disabled')).toBe('true');
    expect(el.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(el);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('keeps keyboard focus across a loading flip', () => {
    const { rerender } = render(<Button onClick={() => undefined}>Run</Button>);
    const el = screen.getByRole('button', { name: 'Run' });
    el.focus();
    rerender(<Button loading onClick={() => undefined}>Run</Button>);
    expect(document.activeElement).toBe(el);
    rerender(<Button onClick={() => undefined}>Run</Button>);
    expect(document.activeElement).toBe(el);
  });

  it('keeps the real disabled attribute for disabled', () => {
    render(<Button disabled>Nope</Button>);
    expect((screen.getByRole('button', { name: 'Nope' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('fires onClick when enabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('IconButton', () => {
  it('exposes the required aria-label as name and tooltip', () => {
    render(<IconButton aria-label="Close panel"><span>x</span></IconButton>);
    const el = screen.getByRole('button', { name: 'Close panel' });
    expect(el.getAttribute('title')).toBe('Close panel');
    expect(el.className).toContain('nuclei-icon-btn');
  });

  it('refuses to render without an accessible name at the type level', () => {
    // @ts-expect-error aria-label is required
    const bad = <IconButton><span>x</span></IconButton>;
    expect(bad).toBeTruthy();
  });
});

describe('Select', () => {
  it('renders a native select with options and reports changes', () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Level" value="a" onChange={onChange}>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );
    const el = screen.getByRole('combobox', { name: 'Level' });
    fireEvent.change(el, { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('TextInput / TextArea', () => {
  it('render labelled controls that inherit the token styling classes', () => {
    render(<><TextInput aria-label="Name" /><TextArea aria-label="Notes" /></>);
    expect(screen.getByRole('textbox', { name: 'Name' }).className).toContain('nuclei-input');
    expect(screen.getByRole('textbox', { name: 'Notes' }).className).toContain('nuclei-textarea');
  });

  it('marks invalid inputs with aria-invalid', () => {
    render(<TextInput aria-label="Name" invalid />);
    expect(screen.getByRole('textbox', { name: 'Name' }).getAttribute('aria-invalid')).toBe('true');
  });
});

describe('Switch', () => {
  it('has role=switch with aria-checked and toggles through onCheckedChange', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} aria-label="Autosave" />);
    const el = screen.getByRole('switch', { name: 'Autosave' });
    expect(el.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(el);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('reflects checked state', () => {
    render(<Switch checked onCheckedChange={() => undefined} aria-label="Autosave" />);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });
});

describe('ChoiceCard', () => {
  it('exposes the accent as a CSS variable and sets no inline border (avoids shorthand/longhand conflict)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<ChoiceCard accent="#00B4D8" title="Learn" description="Guided lessons" aria-label="Learn" />);
    const el = screen.getByRole('button', { name: 'Learn' });
    expect(el.style.getPropertyValue('--choice-accent')).toBe('#00B4D8');
    expect(el.style.border).toBe('');
    expect(el.style.borderLeft).toBe('');
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
