import { beforeEach, describe, expect, it } from 'vitest';
import { selectLiveActivity, useDiscoveryStore } from './discoveryStore';
import { useLabActivityStore } from './labActivityStore';
import { FIXTURE_RUN_ID, fixtureRun } from '../services/discovery/fixtures';
import { createRunView } from '../services/discovery/runView';

beforeEach(() => {
  useDiscoveryStore.getState().reset();
  useLabActivityStore.setState({ discovery: null });
});

describe('wizard state', () => {
  it('opens and closes, and selecting a definition or run closes it', async () => {
    const s = useDiscoveryStore.getState();
    s.openWizard();
    expect(useDiscoveryStore.getState().wizardOpen).toBe(true);
    useDiscoveryStore.getState().selectDefinition('a.discovery.yaml');
    expect(useDiscoveryStore.getState().wizardOpen).toBe(false);
    useDiscoveryStore.getState().openWizard();
    await useDiscoveryStore.getState().selectRun(null);
    expect(useDiscoveryStore.getState().wizardOpen).toBe(false);
    useDiscoveryStore.getState().openWizard();
    useDiscoveryStore.getState().closeWizard();
    expect(useDiscoveryStore.getState().wizardOpen).toBe(false);
  });

  it('reset clears the wizard', () => {
    useDiscoveryStore.getState().openWizard();
    useDiscoveryStore.getState().reset();
    expect(useDiscoveryStore.getState().wizardOpen).toBe(false);
  });
});

describe('selectLiveActivity', () => {
  it('is null with no live run', () => {
    expect(selectLiveActivity({ liveRunIds: [], views: {} })).toBeNull();
  });

  it('describes a paused run from its view', () => {
    const run = fixtureRun({ status: 'paused' });
    expect(selectLiveActivity({ liveRunIds: [FIXTURE_RUN_ID], views: { [FIXTURE_RUN_ID]: createRunView(run, []) } })).toEqual({
      runId: FIXTURE_RUN_ID, name: 'w-state-synthesis', status: 'paused', evaluations: 9, maxEvaluations: 60,
    });
  });

  it('covers a runner that is alive before its first status event', () => {
    expect(selectLiveActivity({ liveRunIds: ['r1'], views: {} })).toMatchObject({ runId: 'r1', status: 'running' });
  });
});
