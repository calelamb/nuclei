// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../platform/buildTarget', () => ({ isWebBuild: () => true }));

import { ExperimentsPanel } from './ExperimentsPanel';

afterEach(cleanup);

describe('ExperimentsPanel on the web build (rq-r3-13)', () => {
  it('uses the shared desktop-only state with one Download action and a QEC alternative', () => {
    render(<ExperimentsPanel />);
    expect(screen.getByText('Experiments live in the desktop app').className).toContain('nuclei-empty__title');
    expect(screen.getAllByRole('button', { name: 'Download Nuclei' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Open QEC Workbench' })).toBeTruthy();
  });
});
