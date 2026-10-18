// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { DiscoveryWorkbench } from './DiscoveryWorkbench';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useProjectStore } from '../../stores/projectStore';
import { FIXTURE_RUN_ID } from '../../services/discovery/fixtures';
import { PROJECT_ROOT, renderOn, resetDiscoveryTestState, seedPopulated } from './testUtils';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: (props: { original: string; modified: string }) => <div data-testid="monaco-diff" data-original={props.original} data-modified={props.modified} />,
  default: () => null,
  loader: { config: () => undefined },
}));

beforeEach(() => resetDiscoveryTestState());
afterEach(() => cleanup());

const drawer = (id: string) => screen.getByRole('dialog', { name: `Candidate ${id}` });

describe('CandidateDrawer', () => {
  it('shows an LLM child: rationale, models, touched dead lines, parent link and a read-only diff against the parent', async () => {
    seedPopulated({ candidateId: 'c-0001' });
    renderOn(<DiscoveryWorkbench />);
    const d = drawer('c-0001');
    expect(within(d).getByText('Share the excitation with a single controlled rotation instead of a CX pair.')).toBeTruthy();
    expect(within(d).getByText('Two fewer CX gates at the same fidelity.')).toBeTruthy();
    expect(within(d).getByText('claude-haiku-5-5')).toBeTruthy();
    expect(within(d).getByText('Breadth · haiku')).toBeTruthy();
    expect(within(d).getByText('Touched dead lines').nextElementSibling?.textContent).toBe('1');
    const diff = await within(d).findByTestId('monaco-diff');
    expect(diff.getAttribute('data-original')).toContain('# program c-0000');
    expect(diff.getAttribute('data-modified')).toContain('# program c-0001');
    fireEvent.click(within(d).getByRole('button', { name: 'c-0000' }));
    expect(useDiscoveryStore.getState().selectedCandidateId).toBe('c-0000');
  });

  it('shows objectives with CIs, the guardrail checklist, timings, stage, cache hit, isolation and the fingerprint', () => {
    seedPopulated({ candidateId: 'c-0003' });
    renderOn(<DiscoveryWorkbench />);
    const d = drawer('c-0003');
    const objectives = within(d).getByRole('table', { name: 'Objectives' });
    expect(objectives.textContent).toContain('Infidelity');
    expect(objectives.textContent).toMatch(/\[0\.0048, 0\.012\]/);
    expect(objectives.textContent).toContain('exact');
    const checklist = within(d).getByRole('list', { name: 'Guardrail checklist' });
    expect(within(checklist).getAllByRole('listitem')).toHaveLength(4);
    expect(d.textContent).toContain('sandbox-exec');
    expect(d.textContent).toContain('ab12ab12ab12ab12…');
    expect(within(d).getByText('Cache hit').nextElementSibling?.textContent).toBe('yes');
    expect(within(d).getByText('Total time').nextElementSibling?.textContent).toBe('640 ms');
  });

  it('shows the gradient map with dead lines flagged', () => {
    seedPopulated({ candidateId: 'c-0009' });
    renderOn(<DiscoveryWorkbench />);
    const d = drawer('c-0009');
    const strip = within(d).getByRole('img', { name: 'Per-line gradient variance' });
    expect(strip.querySelectorAll('.disc-gradient__cell--dead')).toHaveLength(1);
    expect(strip.querySelectorAll('.disc-gradient__cell--live')).toHaveLength(3);
    expect(d.textContent).toContain('Dead lines: 5');
    expect(d.textContent).toContain('exact Pauli propagation');
  });

  it('rejected: shows the guardrail that stopped it, with later checks skipped', () => {
    seedPopulated({ candidateId: 'c-0004' });
    renderOn(<DiscoveryWorkbench />);
    const d = drawer('c-0004');
    expect(within(d).getByRole('alert').textContent).toContain('Rejected by no_noise');
    expect(within(d).getByRole('list', { name: 'Guardrail checklist' }).textContent).toContain('Failed');
    expect(within(d).queryByRole('table', { name: 'Objectives' })).toBeNull();
    expect(d.textContent).toContain('No objectives: the candidate was not scored.');
  });

  it('failed: shows the failure and stderr', () => {
    seedPopulated({ candidateId: 'c-0005' });
    renderOn(<DiscoveryWorkbench />);
    const d = drawer('c-0005');
    expect(d.textContent).toContain('Failed in the sandbox stage (entry_raised)');
    expect(within(d).getByLabelText('stderr').textContent).toContain('ValueError: boom');
  });

  it('screened out, duplicate and invalid proposals explain themselves', () => {
    seedPopulated({ candidateId: 'c-0006' });
    renderOn(<DiscoveryWorkbench />);
    expect(drawer('c-0006').textContent).toContain('cannot enter the archive');
    expect(drawer('c-0006').textContent).toContain('Objectives (screen estimate)');
    cleanup();
    seedPopulated({ candidateId: 'c-0007' });
    renderOn(<DiscoveryWorkbench />);
    expect(drawer('c-0007').textContent).toContain('Same normalized program as c-0003');
    cleanup();
    seedPopulated({ candidateId: 'c-0008' });
    renderOn(<DiscoveryWorkbench />);
    expect(drawer('c-0008').textContent).toContain('search text matched 2 times');
  });

  it('the seed shows its program rather than a diff', () => {
    seedPopulated({ candidateId: 'c-0000' });
    renderOn(<DiscoveryWorkbench />);
    expect(within(drawer('c-0000')).queryByTestId('monaco-diff')).toBeNull();
    expect(within(drawer('c-0000')).getByLabelText('Program c-0000')).toBeTruthy();
  });

  it('Promote and Re-evaluate call the store; Re-evaluate is disabled while the run is live', async () => {
    seedPopulated({ candidateId: 'c-0003' });
    const promote = vi.fn(async () => ({ ok: true as const, path: 'discovery/w_state.c-0003.py' }));
    const reeval = vi.fn(async () => ({ ok: true as const }));
    useDiscoveryStore.setState({ promoteCandidate: promote, reevaluateCandidate: reeval });
    renderOn(<DiscoveryWorkbench />);
    const d = drawer('c-0003');
    fireEvent.click(within(d).getByRole('button', { name: /Promote/ }));
    expect(promote).toHaveBeenCalledWith(FIXTURE_RUN_ID, 'c-0003');
    expect(await within(d).findByText('Wrote discovery/w_state.c-0003.py')).toBeTruthy();
    fireEvent.click(within(d).getByRole('button', { name: /Re-evaluate/ }));
    expect(reeval).toHaveBeenCalledWith(FIXTURE_RUN_ID, 'c-0003');
    cleanup();
    seedPopulated({ candidateId: 'c-0003', liveRunIds: [FIXTURE_RUN_ID] });
    renderOn(<DiscoveryWorkbench />);
    expect((within(drawer('c-0003')).getByRole('button', { name: /Re-evaluate/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Open as file promotes, opens a tab and shows the editor', async () => {
    seedPopulated({ candidateId: 'c-0003' });
    const promote = vi.fn(async () => ({ ok: true as const, path: 'discovery/w_state.c-0003.py' }));
    useDiscoveryStore.setState({ promoteCandidate: promote });
    useNavigationStore.setState({ activeView: 'discovery' });
    renderOn(<DiscoveryWorkbench />);
    fireEvent.click(within(drawer('c-0003')).getByRole('button', { name: /Open as file/ }));
    await vi.waitFor(() => expect(useProjectStore.getState().tabs.some((t) => t.path === `${PROJECT_ROOT}/discovery/w_state.c-0003.py`)).toBe(true));
    expect(useNavigationStore.getState().activeView).toBe('files');
  });

  it('Escape closes the drawer', () => {
    seedPopulated({ candidateId: 'c-0003' });
    renderOn(<DiscoveryWorkbench />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useDiscoveryStore.getState().selectedCandidateId).toBeNull();
  });
});
