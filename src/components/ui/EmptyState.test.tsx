// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

afterEach(cleanup);

describe('EmptyState', () => {
  it('renders title, body and one action', () => {
    render(<EmptyState title="No plugins yet" action={<button>Load plugin</button>}>Load one from disk.</EmptyState>);
    expect(screen.getByText('No plugins yet').className).toContain('nuclei-empty__title');
    expect(screen.getByText('Load one from disk.').className).toContain('nuclei-empty__body');
    expect(screen.getByRole('button', { name: 'Load plugin' })).toBeTruthy();
  });

  it('hides the decorative icon from assistive tech', () => {
    const { container } = render(<EmptyState title="Empty" icon={<svg data-testid="i" />} />);
    expect(container.querySelector('.nuclei-empty__icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('omits optional parts when absent', () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(container.querySelector('.nuclei-empty__body')).toBeNull();
    expect(container.querySelector('.nuclei-empty__action')).toBeNull();
  });
});
