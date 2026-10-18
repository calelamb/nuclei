// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { BrokenExperimentCard } from './BrokenExperimentCard';
import { PlatformProvider } from '../../platform/PlatformProvider';
import type { PlatformBridge } from '../../platform/bridge';
import { useProjectStore } from '../../stores/projectStore';
import { useDiracPanelStore } from '../../stores/diracPanelStore';

const ERRORS = [
  'backend: Invalid input: expected object, received string',
  'seed: Invalid input: expected number, received undefined',
];

function mount(readFile = vi.fn(async () => 'name: x')) {
  return render(
    <PlatformProvider bridge={{ readFile } as unknown as PlatformBridge}>
      <BrokenExperimentCard projectRoot="/proj" fileName="broken.experiment.yaml" errors={ERRORS} />
    </PlatformProvider>,
  );
}

describe('BrokenExperimentCard', () => {
  afterEach(cleanup);

  it('collapses to the file name and a problem count', () => {
    mount();
    expect(screen.getByText('2 problems')).toBeTruthy();
    expect(screen.queryByText(/is required but missing/)).toBeNull();
  });

  it('expands to plain-language problems, never raw validator text', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /broken.experiment.yaml/ }));
    expect(screen.getByText('“seed” is required but missing.')).toBeTruthy();
    expect(screen.queryByText(/Invalid input/)).toBeNull();
  });

  it('opens the file in the editor', async () => {
    const openTab = vi.fn();
    useProjectStore.setState({ openTab });
    mount();
    fireEvent.click(screen.getByRole('button', { name: /broken.experiment.yaml/ }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open file' })); });
    expect(openTab).toHaveBeenCalledWith({ path: '/proj/experiments/broken.experiment.yaml', content: 'name: x' });
  });

  it('hands the problems to Dirac', () => {
    const ask = vi.fn();
    useDiracPanelStore.setState({ ask });
    mount();
    fireEvent.click(screen.getByRole('button', { name: /broken.experiment.yaml/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ask Dirac to fix' }));
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('“seed” is required but missing.'));
  });
});
