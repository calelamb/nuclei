// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Glossary } from './Glossary';
import { useGlossaryStore } from '../../stores/glossaryStore';

beforeEach(() => {
  useGlossaryStore.getState().setCategory('all');
  useGlossaryStore.getState().setSearch('');
});
afterEach(cleanup);

describe('Glossary search', () => {
  it('names what matched nothing and offers a way back', () => {
    render(<Glossary variant="page" />);
    const input = screen.getByRole('textbox', { name: 'Search glossary terms' });
    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(screen.getByText('No terms match "zzzz"')).toBeTruthy();
    expect(screen.queryByText('No terms found.')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Clear search' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Show all terms' }));
    expect(document.activeElement).toBe(input);
    expect(useGlossaryStore.getState().searchQuery).toBe('');
    expect(useGlossaryStore.getState().filteredTerms.length).toBeGreaterThan(0);
  });

  it('Escape clears the query first', () => {
    render(<Glossary variant="page" />);
    const input = screen.getByRole('textbox', { name: 'Search glossary terms' });
    fireEvent.change(input, { target: { value: 'zzzz' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(useGlossaryStore.getState().searchQuery).toBe('');
    expect(useGlossaryStore.getState().filteredTerms.length).toBeGreaterThan(0);
  });

  it('draws the search through the shared TextInput, with no hand-rolled field group', () => {
    const { container } = render(<Glossary />);
    expect(container.querySelector('input.nuclei-input')).not.toBeNull();
    expect(container.querySelector('.nuclei-field-group, .nuclei-bare-input')).toBeNull();
  });
});
