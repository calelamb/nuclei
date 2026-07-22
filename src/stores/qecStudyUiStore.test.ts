import { afterEach, describe, expect, it } from 'vitest';
import { useQecStudyStore } from '../services/qecStudyStore';
import { useQecStudyUiStore } from './qecStudyUiStore';

const study = {
  fileName: 'good.qec-study.yaml',
  path: '/p/studies/good.qec-study.yaml',
  study: {
    schema: 1 as const,
    id: 'good',
    name: 'Good study',
    question: 'Does it work?',
    preset: 'analyze' as const,
    tags: [],
    sources: [],
  },
};

describe('qecStudyUiStore', () => {
  afterEach(() => {
    useQecStudyStore.setState({ studies: [], validationErrors: [], loading: false });
    useQecStudyUiStore.getState().clearActiveStudy();
  });

  it('selects known Studies and normalizes a missing active ID to null', () => {
    useQecStudyStore.setState({ studies: [study] });

    useQecStudyUiStore.getState().setActiveStudy('good');
    expect(useQecStudyUiStore.getState().activeStudyId).toBe('good');

    useQecStudyUiStore.getState().setActiveStudy('missing');
    expect(useQecStudyUiStore.getState().activeStudyId).toBeNull();
  });

  it('clears an active Study that disappears during discovery refresh', () => {
    useQecStudyStore.setState({ studies: [study] });
    useQecStudyUiStore.getState().setActiveStudy('good');

    useQecStudyStore.setState({ studies: [] });

    expect(useQecStudyUiStore.getState().activeStudyId).toBeNull();
  });
});
