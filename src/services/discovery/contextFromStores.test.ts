import { beforeEach, describe, expect, it } from 'vitest';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { FIXTURE_RUN_ID, fixtureRun } from './fixtures';
import { createRunView } from './runView';
import { buildDiscoveryContextFromStores } from './contextFromStores';
import { makeSpec } from './testkit';

beforeEach(() => useDiscoveryStore.getState().reset());

describe('buildDiscoveryContextFromStores', () => {
  it('is empty before anything is selected', () => {
    expect(buildDiscoveryContextFromStores()).toBe('');
  });

  it('describes the selected study when no run is open', () => {
    const spec = makeSpec();
    useDiscoveryStore.setState({
      definitions: [{ fileName: 'toy.discovery.yaml', path: '/p/experiments/toy.discovery.yaml', spec }],
      selectedDefinition: 'toy.discovery.yaml',
    });
    const text = buildDiscoveryContextFromStores();
    expect(text).toContain('## Discovery Engine');
    expect(text).toContain(`Study: ${spec.name}`);
    expect(text).not.toContain('Run ');
  });

  it('describes the selected run', () => {
    const run = fixtureRun({ status: 'running' });
    useDiscoveryStore.setState({ views: { [FIXTURE_RUN_ID]: createRunView(run, []) }, selectedRunId: FIXTURE_RUN_ID });
    expect(buildDiscoveryContextFromStores()).toContain(`Run ${FIXTURE_RUN_ID}`);
  });
});
