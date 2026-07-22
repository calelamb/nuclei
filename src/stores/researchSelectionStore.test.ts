import { afterEach, describe, expect, it } from 'vitest';
import type { QecEntityRef } from '../types/qecSelection';
import {
  EMPTY_RESEARCH_SELECTION,
  useResearchSelectionStore,
} from './researchSelectionStore';

const detector: QecEntityRef = { kind: 'detector', id: 'D42', sessionId: 's1' };
const tick: QecEntityRef = { kind: 'tick', id: '31', sessionId: 's1' };

function resetStore(): void {
  useResearchSelectionStore.setState({
    past: [],
    present: EMPTY_RESEARCH_SELECTION,
    future: [],
  });
}

describe('researchSelectionStore', () => {
  afterEach(resetStore);

  it('navigates a detector-to-tick refinement without mutating prior history', () => {
    const store = useResearchSelectionStore.getState();
    store.selectPrimary(detector, 'panel');
    const before = useResearchSelectionStore.getState().present;

    store.refineScope(tick, 'panel');

    expect(before.scope).toEqual([]);
    expect(useResearchSelectionStore.getState().present.scope).toEqual([tick]);
    useResearchSelectionStore.getState().back();
    expect(useResearchSelectionStore.getState().present).toEqual(before);
  });

  it('keeps only the latest 100 immutable selections in history', () => {
    for (let index = 0; index < 101; index += 1) {
      useResearchSelectionStore.getState().selectPrimary(
        { kind: 'detector', id: `D${index}` },
        'panel',
      );
    }

    const { past, present } = useResearchSelectionStore.getState();
    expect(past).toHaveLength(100);
    expect(past[0]).toMatchObject({ primary: { id: 'D0' } });
    expect(present.primary).toMatchObject({ id: 'D100' });
  });

  it('deduplicates scope refs deterministically by their stable identity', () => {
    const store = useResearchSelectionStore.getState();
    store.selectPrimary(detector, 'panel');
    store.refineScope(tick, 'panel');
    store.refineScope({ ...tick }, 'dirac');
    store.refineScope({ ...tick, datasetId: 'results-a' }, 'alert');

    expect(useResearchSelectionStore.getState().present).toMatchObject({
      source: 'alert',
      scope: [tick, { ...tick, datasetId: 'results-a' }],
    });
  });

  it('rejects a conflicting session scope except cohorts and findings', () => {
    const store = useResearchSelectionStore.getState();
    store.selectPrimary(detector, 'panel');
    const before = useResearchSelectionStore.getState().present;

    store.refineScope({ kind: 'tick', id: '32', sessionId: 's2' }, 'panel');
    expect(useResearchSelectionStore.getState().present).toBe(before);

    store.refineScope({ kind: 'cohort', id: 'c1', sessionId: 's2' }, 'panel');
    store.refineScope({ kind: 'finding', id: 'f1', sessionId: 's2' }, 'panel');
    expect(useResearchSelectionStore.getState().present.scope).toEqual([
      { kind: 'cohort', id: 'c1', sessionId: 's2' },
      { kind: 'finding', id: 'f1', sessionId: 's2' },
    ]);
  });

  it('clears forward history when a new selection branches after back', () => {
    const store = useResearchSelectionStore.getState();
    store.selectPrimary(detector, 'panel');
    store.refineScope(tick, 'panel');
    store.back();
    store.setTimeWindow({ start: 0, end: 4, domain: 'tick' }, 'panel');

    expect(useResearchSelectionStore.getState().future).toEqual([]);
    store.forward();
    expect(useResearchSelectionStore.getState().present.timeWindow).toEqual({
      start: 0,
      end: 4,
      domain: 'tick',
    });
  });

  it('restores a refinement forward without mutating back-history arrays', () => {
    const store = useResearchSelectionStore.getState();
    store.selectPrimary(detector, 'panel');
    store.refineScope(tick, 'panel');
    const refined = useResearchSelectionStore.getState().present;

    store.back();
    const afterBack = useResearchSelectionStore.getState();
    const pastBeforeForward = afterBack.past;
    const futureBeforeForward = afterBack.future;
    const pastSnapshot = [...pastBeforeForward];
    const futureSnapshot = [...futureBeforeForward];

    store.forward();

    const afterForward = useResearchSelectionStore.getState();
    expect(afterForward.present).toEqual(refined);
    expect(afterForward.past).not.toBe(pastBeforeForward);
    expect(afterForward.future).not.toBe(futureBeforeForward);
    expect(afterBack.past).toEqual(pastSnapshot);
    expect(afterBack.future).toEqual(futureSnapshot);
  });

  it('normalizes valid inputs and rejects malformed refs and time windows', () => {
    const store = useResearchSelectionStore.getState();
    store.selectPrimary(
      { kind: 'detector', id: ' D42 ', sessionId: ' s1 ', datasetId: ' ' },
      'panel',
    );
    expect(useResearchSelectionStore.getState().present.primary).toEqual(detector);

    const before = useResearchSelectionStore.getState();
    store.refineScope({ kind: 'unknown', id: 'D43' } as QecEntityRef, 'panel');
    store.setTimeWindow({ start: 5, end: 4, domain: 'tick' }, 'panel');
    expect(useResearchSelectionStore.getState()).toBe(before);
  });

  it('rejects an invalid selection source at the store boundary', () => {
    const before = useResearchSelectionStore.getState();

    useResearchSelectionStore.getState().selectPrimary(
      detector,
      'external-widget' as 'panel',
    );

    expect(useResearchSelectionStore.getState()).toBe(before);
  });

  it('clears the complete history and selection', () => {
    const store = useResearchSelectionStore.getState();
    store.selectPrimary(detector, 'panel');
    store.refineScope(tick, 'panel');

    store.clear();

    expect(useResearchSelectionStore.getState()).toMatchObject({
      past: [],
      present: EMPTY_RESEARCH_SELECTION,
      future: [],
    });
  });
});
