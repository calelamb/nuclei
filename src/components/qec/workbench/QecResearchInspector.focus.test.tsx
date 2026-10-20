// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QecResearchInspector } from './QecResearchInspector';
import { resetQecWorkbenchTestState } from './qecWorkbenchTestUtils';

beforeEach(resetQecWorkbenchTestState);
afterEach(cleanup);

describe('inspector focus (interaction-r-10)', () => {
  it('does not take focus when the workbench mounts with the inspector open, even under StrictMode', () => {
    render(<StrictMode><QecResearchInspector open onClose={() => undefined} /></StrictMode>);
    const inspector = screen.getByRole('complementary', { name: 'Research inspector' });
    expect(inspector.contains(document.activeElement)).toBe(false);
  });

  it('moves focus to the heading, not the close button, when it is opened later', () => {
    const { rerender } = render(<QecResearchInspector open={false} onClose={() => undefined} />);
    rerender(<QecResearchInspector open onClose={() => undefined} />);
    const inspector = screen.getByRole('complementary', { name: 'Research inspector' });
    expect(document.activeElement).toBe(within(inspector).getByRole('heading', { name: 'Inspector' }));
  });

  it('does not list the inspector among the instruments it offers to pin', () => {
    render(<QecResearchInspector open onClose={() => undefined} />);
    expect(screen.queryByText('Research Inspector')).toBeNull();
  });
});
