// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { DiscoverySidebar } from './DiscoverySidebar';
import { DiscoveryWorkbench } from './DiscoveryWorkbench';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { useProjectStore } from '../../stores/projectStore';
import type { DiscoveryEnv } from '../../services/discovery/env';
import { createFakeKernel, createFakeLlm, createManualClock, createMemoryFs, joinPath, testHash } from '../../services/discovery/testkit';
import { PROJECT_ROOT, renderOn, resetDiscoveryTestState } from './testUtils';

const DEFINITION = `schema: 1
type: discovery
name: toy
program: discovery/toy.py
evaluator: { kind: state_synthesis, config: {} }
mutator: { kind: ast }
`;

const created: DiscoveryEnv[] = [];
let kernelOpened = 0;

vi.mock('../../services/discovery/env', () => ({
  createDiscoveryEnv: () => {
    const kernel = createFakeKernel();
    const env: DiscoveryEnv = {
      fs: createMemoryFs({ [`${'/proj'}/experiments/toy.discovery.yaml`]: DEFINITION, '/proj/discovery/toy.py': 'x = 1\n' }),
      join: joinPath,
      hash: testHash,
      clock: createManualClock(),
      llm: createFakeLlm(),
      openSession: async () => {
        kernelOpened += 1;
        return kernel.session;
      },
    };
    created.push(env);
    return env;
  },
}));

beforeEach(() => {
  created.length = 0;
  kernelOpened = 0;
  resetDiscoveryTestState();
});
afterEach(() => cleanup());

describe('useDiscoveryBoot', () => {
  it('configures once for the platform, loads definitions and the evaluator catalog', async () => {
    useProjectStore.setState({ projectRoot: PROJECT_ROOT });
    renderOn(
      <>
        <DiscoverySidebar />
        <DiscoveryWorkbench />
      </>,
    );
    await waitFor(() => expect(useDiscoveryStore.getState().definitions.map((d) => d.fileName)).toEqual(['toy.discovery.yaml']));
    await waitFor(() => expect(useDiscoveryStore.getState().evaluators).toHaveLength(1));
    expect(created).toHaveLength(1);
    expect(kernelOpened).toBe(1);
    expect(screen.getAllByText('toy').length).toBeGreaterThan(0);
  });

  it('does nothing on the web build', () => {
    useProjectStore.setState({ projectRoot: PROJECT_ROOT });
    renderOn(<DiscoveryWorkbench />, 'web');
    expect(created).toHaveLength(0);
    expect(useDiscoveryStore.getState().definitions).toEqual([]);
    expect(screen.getByText('The Discovery Engine needs the desktop kernel')).toBeTruthy();
  });

  it('waits for a project before reloading', async () => {
    renderOn(<DiscoverySidebar />);
    expect(useDiscoveryStore.getState().projectRoot).toBeNull();
    expect(kernelOpened).toBe(0);
  });
});
