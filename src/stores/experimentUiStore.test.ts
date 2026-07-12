import { afterEach, describe, expect, it } from 'vitest';
import { useExperimentUiStore } from './experimentUiStore';

const RESET = {
  selectedExperimentFileName: null,
  selectedRunDir: null,
  compareSelection: [],
  compareOpen: false,
};

describe('experimentUiStore', () => {
  afterEach(() => {
    useExperimentUiStore.setState(RESET);
  });

  it('toggles a run dir in and out of the compare selection, preserving check order', () => {
    const { toggleCompareSelection } = useExperimentUiStore.getState();
    toggleCompareSelection('a');
    toggleCompareSelection('b');
    expect(useExperimentUiStore.getState().compareSelection).toEqual(['a', 'b']);
    toggleCompareSelection('a');
    expect(useExperimentUiStore.getState().compareSelection).toEqual(['b']);
  });

  it('opens and closes the compare view independently of the selection', () => {
    const { toggleCompareSelection, openCompare, closeCompare } = useExperimentUiStore.getState();
    toggleCompareSelection('a');
    toggleCompareSelection('b');
    openCompare();
    expect(useExperimentUiStore.getState().compareOpen).toBe(true);
    closeCompare();
    expect(useExperimentUiStore.getState().compareOpen).toBe(false);
    expect(useExperimentUiStore.getState().compareSelection).toEqual(['a', 'b']);
  });

  it('clearCompareSelection empties the selection and closes the view', () => {
    const { toggleCompareSelection, openCompare, clearCompareSelection } = useExperimentUiStore.getState();
    toggleCompareSelection('a');
    openCompare();
    clearCompareSelection();
    expect(useExperimentUiStore.getState().compareSelection).toEqual([]);
    expect(useExperimentUiStore.getState().compareOpen).toBe(false);
  });

  it('selecting a (possibly different) experiment resets run selection and compare state', () => {
    const { toggleCompareSelection, openCompare, selectRun, selectExperiment } = useExperimentUiStore.getState();
    selectExperiment('a.experiment.yaml');
    selectRun('run-1');
    toggleCompareSelection('run-1');
    toggleCompareSelection('run-2');
    openCompare();

    selectExperiment('b.experiment.yaml');

    const state = useExperimentUiStore.getState();
    expect(state.selectedExperimentFileName).toBe('b.experiment.yaml');
    expect(state.selectedRunDir).toBeNull();
    expect(state.compareSelection).toEqual([]);
    expect(state.compareOpen).toBe(false);
  });
});
