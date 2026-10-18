// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SearchField } from './SearchField';

afterEach(cleanup);

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <SearchField aria-label="Search things" placeholder="Search" value={value} onValueChange={setValue} />;
}

describe('SearchField', () => {
  it('is a labelled text box with a decorative magnifier and no clear button while empty', () => {
    render(<Harness />);
    expect(screen.getByRole('textbox', { name: 'Search things' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  it('reports typing and offers Clear once there is text, returning focus behaviour to the field', () => {
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: 'Search things' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(input.value).toBe('zzzz');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
  });

  it('Escape clears a non-empty query without blurring, then blurs when already empty', () => {
    render(<Harness initial="zzzz" />);
    const input = screen.getByRole('textbox', { name: 'Search things' }) as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.activeElement).not.toBe(input);
  });
});
