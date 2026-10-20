// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DiracMarkdown, COPIED_MS } from './DiracMarkdown';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('DiracMarkdown', () => {
  it('renders a GFM table as a table, not as literal pipes', () => {
    render(<DiracMarkdown content={'| Outcome | Probability |\n|---|---|\n| |0⟩ | 50% |\n| |1⟩ | 50% |'} />);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Outcome', 'Probability']);
    expect(document.body.textContent).not.toContain('|---|');
  });

  it('renders a blockquote element', () => {
    const { container } = render(<DiracMarkdown content={'> measurement collapses the state'} />);
    expect(container.querySelector('blockquote')?.textContent).toContain('measurement collapses');
  });

  it('keeps headings as headings (their size is capped in CSS, not by dropping the element)', () => {
    render(<DiracMarkdown content={'# Big idea\n\ntext'} />);
    expect(screen.getByRole('heading', { name: 'Big idea' })).toBeTruthy();
  });

  it('gives code blocks syntax highlighting and a copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { container } = render(<DiracMarkdown content={'```python\nfrom qiskit import QuantumCircuit  # build\nqc = QuantumCircuit(1)\n```'} />);
    expect(container.querySelector('.tok--keyword')?.textContent).toBe('from');
    expect(container.querySelector('.tok--comment')?.textContent).toBe('# build');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy code' })); });
    expect(writeText).toHaveBeenCalledWith('from qiskit import QuantumCircuit  # build\nqc = QuantumCircuit(1)');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(COPIED_MS + 10); });
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy();
  });

  it('says so when the clipboard is blocked instead of failing silently', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    render(<DiracMarkdown content={'```\nqc.h(0)\n```'} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy code' })); });
    expect(screen.getByRole('status').textContent).toBe("Couldn't copy: clipboard blocked");
  });
});
