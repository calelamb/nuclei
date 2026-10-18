import { vi } from 'vitest';
import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { withPlatform } from '../../services/trainability/testBridge';
import {
  FIXTURE_DEFINITION_FILE,
  FIXTURE_EVALUATOR,
  FIXTURE_RUN_ID,
  fixtureCandidates,
  fixtureConfirmation,
  fixtureDefinition,
  fixtureRun,
} from '../../services/discovery/fixtures';
import { computeKpis } from '../../services/discovery/kpis';
import { createRunView } from '../../services/discovery/runView';
import { useDiscoveryStore, type DiscoveryState } from '../../stores/discoveryStore';
import { useProjectStore } from '../../stores/projectStore';
import type { RunRecord } from '../../types/discovery';
import { __resetDiscoveryBoot } from './useDiscoveryBoot';

export const PROJECT_ROOT = '/proj';

export function resetDiscoveryTestState(): void {
  useDiscoveryStore.getState().reset();
  useProjectStore.setState({ projectRoot: null });
  __resetDiscoveryBoot();
}

type Seed = Partial<Pick<DiscoveryState, 'liveRunIds' | 'pendingActions' | 'error' | 'evaluatorsError' | 'wizardOpen' | 'loading'>> & {
  run?: Partial<RunRecord>;
  confirmed?: boolean;
  select?: 'run' | 'definition' | 'none';
  candidateId?: string | null;
};

/** Seed the store with the fixture run (and its definition) as if loaded from disk. */
export function seedPopulated(seed: Seed = {}): void {
  const run = fixtureRun({ ...(seed.confirmed ? { confirmation: fixtureConfirmation() } : {}), ...seed.run });
  const view = createRunView(run, fixtureCandidates());
  const select = seed.select ?? 'run';
  useProjectStore.setState({ projectRoot: PROJECT_ROOT });
  useDiscoveryStore.setState({
    projectRoot: PROJECT_ROOT,
    definitions: [fixtureDefinition()],
    evaluators: [FIXTURE_EVALUATOR],
    runsByDefinition: { [FIXTURE_DEFINITION_FILE]: [run] },
    views: { [FIXTURE_RUN_ID]: view },
    kpis: { [FIXTURE_RUN_ID]: computeKpis(run, fixtureCandidates()) },
    liveRunIds: seed.liveRunIds ?? [],
    pendingActions: seed.pendingActions ?? {},
    error: seed.error ?? null,
    evaluatorsError: seed.evaluatorsError ?? null,
    wizardOpen: seed.wizardOpen ?? false,
    loading: seed.loading ?? false,
    selectedDefinition: select === 'none' ? null : FIXTURE_DEFINITION_FILE,
    selectedRunId: select === 'run' ? FIXTURE_RUN_ID : null,
    selectedCandidateId: seed.candidateId ?? null,
  });
}

export function renderOn(node: ReactNode, platform: 'desktop' | 'web' = 'desktop') {
  const Wrapper = withPlatform(platform);
  return render(<Wrapper>{node}</Wrapper>);
}

/** Replace store actions with spies; returns them. */
export function spyOnActions<K extends keyof DiscoveryState>(names: K[]): Record<K, ReturnType<typeof vi.fn>> {
  const spies = {} as Record<K, ReturnType<typeof vi.fn>>;
  const patch: Record<string, unknown> = {};
  for (const name of names) {
    spies[name] = vi.fn(async () => ({ ok: true }));
    patch[name as string] = spies[name];
  }
  useDiscoveryStore.setState(patch as Partial<DiscoveryState>);
  return spies;
}
