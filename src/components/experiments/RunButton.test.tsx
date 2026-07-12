// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { RunButton } from './RunButton';
import { useExperimentRunStore } from '../../stores/experimentRunStore';
import type { DiscoveredExperiment } from '../../services/experimentStore';

const SIM_EXPERIMENT: DiscoveredExperiment = {
  fileName: 'theta-sweep.experiment.yaml',
  path: '/proj/experiments/theta-sweep.experiment.yaml',
  spec: {
    schema: 1, name: 'theta-sweep', entry: 'run.py', language: 'python',
    backend: { provider: 'simulator', target: 'statevector' }, shots: 100, seed: 42,
    sweep: { theta: { values: [0, 1] } },
  },
};

const HARDWARE_EXPERIMENT: DiscoveredExperiment = {
  ...SIM_EXPERIMENT,
  fileName: 'hw-sweep.experiment.yaml',
  spec: { ...SIM_EXPERIMENT.spec, name: 'hw-sweep', backend: { provider: 'ionq', target: 'ionq.qpu' } },
};

describe('RunButton', () => {
  beforeEach(() => {
    useExperimentRunStore.setState({ active: null, lastSummary: null, lastError: null });
  });

  afterEach(() => cleanup());

  it('shows live completed/total progress and a cancel button when this experiment is active', () => {
    const cancel = vi.fn();
    useExperimentRunStore.setState({
      active: {
        experimentFileName: SIM_EXPERIMENT.fileName,
        experimentName: 'theta-sweep',
        progress: { completed: 3, total: 8, failures: 1, currentPoint: 2 },
        cancel,
      },
    });

    const { getByText } = render(
      <RunButton experiment={SIM_EXPERIMENT} projectRoot="/proj" pointCount={8} />,
    );
    expect(getByText(/3\/8/)).toBeTruthy();
    expect(getByText(/1 failed/)).toBeTruthy();

    fireEvent.click(getByText('Cancel'));
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('disables the Run button for OTHER experiments while a sweep is active', () => {
    useExperimentRunStore.setState({
      active: {
        experimentFileName: 'some-other.experiment.yaml',
        experimentName: 'other',
        progress: { completed: 0, total: 1, failures: 0, currentPoint: -1 },
        cancel: vi.fn(),
      },
    });

    const { getByText } = render(
      <RunButton experiment={SIM_EXPERIMENT} projectRoot="/proj" pointCount={2} />,
    );
    const button = getByText('Run') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('opens the hardware guard for a non-simulator backend and requires confirmation', () => {
    const { getByText, queryByRole } = render(
      <RunButton experiment={HARDWARE_EXPERIMENT} projectRoot="/proj" pointCount={2} />,
    );
    expect(queryByRole('alertdialog')).toBeNull();

    fireEvent.click(getByText('Run'));
    const dialog = queryByRole('alertdialog');
    expect(dialog).toBeTruthy();
    expect(dialog!.textContent).toContain('2');
    expect(dialog!.textContent).toContain('points');
    expect(dialog!.textContent).toContain('ionq/ionq.qpu');
  });

  it('requires typing the experiment name above the hardware confirmation threshold', () => {
    const manyPointsExperiment: DiscoveredExperiment = {
      ...HARDWARE_EXPERIMENT,
      spec: { ...HARDWARE_EXPERIMENT.spec, sweep: { theta: { values: Array.from({ length: 12 }, (_, i) => i) } } },
    };
    const { getByText, getByPlaceholderText } = render(
      <RunButton experiment={manyPointsExperiment} projectRoot="/proj" pointCount={12} />,
    );
    fireEvent.click(getByText('Run'));

    const confirmButton = getByText('Submit to hardware') as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(getByPlaceholderText('hw-sweep'), { target: { value: 'hw-sweep' } });
    expect(confirmButton.disabled).toBe(false);
  });
});
