// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { ExperimentBreadcrumbs } from './Breadcrumbs';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { useExperimentStore } from '../../services/experimentStore';
import type { AnyExperimentSpec } from '../../types/experiment';

const spec = {
  schema: 1,
  type: 'sweep',
  name: 'theta-sweep',
  entry: 'run.py',
  language: 'python',
  backend: { provider: 'simulator', target: 'statevector' },
  shots: 1024,
  seed: 42,
} as AnyExperimentSpec;

afterEach(() => cleanup());

describe('<ExperimentBreadcrumbs> (PRD 11 Phase C)', () => {
  beforeEach(() => {
    useExperimentStore.setState({
      experiments: [{ fileName: 'theta-sweep.experiment.yaml', path: '/p/theta-sweep.experiment.yaml', spec }],
    });
    useExperimentUiStore.setState({
      selectedExperimentFileName: null,
      selectedRunDir: null,
      compareSelection: [],
      compareOpen: false,
    });
  });

  it('renders nothing when no experiment is selected', () => {
    const { container } = render(<ExperimentBreadcrumbs />);
    expect(container.firstChild).toBeNull();
  });

  it('shows just the experiment name at the runs-table level (no trailing segment)', () => {
    useExperimentUiStore.setState({ selectedExperimentFileName: 'theta-sweep.experiment.yaml' });
    const { getByText, container } = render(<ExperimentBreadcrumbs />);
    expect(getByText('theta-sweep')).toBeTruthy();
    // No trailing run/compare segment yet — the name is not a back button.
    expect(container.querySelector('button')).toBeNull();
  });

  it('shows a run trail and the experiment segment navigates back to runs', () => {
    useExperimentUiStore.setState({
      selectedExperimentFileName: 'theta-sweep.experiment.yaml',
      selectedRunDir: '20260712-141530-a3f9',
    });
    const { getByText, getByRole } = render(<ExperimentBreadcrumbs />);
    expect(getByText('20260712-141530-a3f9')).toBeTruthy();
    // The experiment name is now a clickable "back to runs".
    fireEvent.click(getByRole('button', { name: 'theta-sweep' }));
    expect(useExperimentUiStore.getState().selectedRunDir).toBeNull();
  });

  it('shows a Compare trail with the selection count', () => {
    useExperimentUiStore.setState({
      selectedExperimentFileName: 'theta-sweep.experiment.yaml',
      compareOpen: true,
      compareSelection: ['a', 'b', 'c'],
    });
    const { getByText } = render(<ExperimentBreadcrumbs />);
    expect(getByText('Compare (3)')).toBeTruthy();
  });
});
