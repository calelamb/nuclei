// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { NewDiscoveryWizard } from './NewDiscoveryWizard';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { renderOn, resetDiscoveryTestState } from './testUtils';

beforeEach(() => resetDiscoveryTestState());
afterEach(() => cleanup());

function stubCreate(result: { ok: true; definitionFile: string } | { ok: false; error: string }) {
  const create = vi.fn(async () => result);
  useDiscoveryStore.setState({ createFromTemplate: create as never });
  return create;
}

describe('NewDiscoveryWizard', () => {
  it('offers the four templates and labels the Frontier as a research instrument with honesty text', () => {
    renderOn(<NewDiscoveryWizard />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual([
      expect.stringContaining('QEC memory schedule'),
      expect.stringContaining('W-state synthesis'),
      expect.stringContaining('TFIM ground-state ansatz'),
      expect.stringContaining('Trainability frontier'),
    ]);
    const frontier = radios[3];
    expect(frontier.textContent).toContain('Research instrument');
    expect(frontier.textContent).toContain('Is every trainable ansatz classically simulable?');
    expect(frontier.textContent).toContain('It is not a proof of classical hardness');
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
  });

  it('requires a name before creating', () => {
    const create = stubCreate({ ok: true, definitionFile: 'x.discovery.yaml' });
    renderOn(<NewDiscoveryWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Create discovery' }));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('Give the discovery a name');
  });

  it('creates from the selected template with budgets and mutator settings', async () => {
    const create = stubCreate({ ok: true, definitionFile: 'frontier-run.discovery.yaml' });
    renderOn(<NewDiscoveryWizard />);
    fireEvent.click(screen.getAllByRole('radio')[3]);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Frontier run' } });
    expect(screen.getByText('Writes experiments/frontier-run.discovery.yaml')).toBeTruthy();
    const evals = screen.getByLabelText('Max evaluations');
    fireEvent.change(evals, { target: { value: '50' } });
    fireEvent.blur(evals);
    fireEvent.change(screen.getByLabelText('Breadth model'), { target: { value: 'sonnet' } });
    fireEvent.click(screen.getByLabelText(/Batch mode/));
    fireEvent.click(screen.getByRole('button', { name: 'Create discovery' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith(
      'trainability-frontier',
      'Frontier run',
      { max_evaluations: 50, max_llm_calls: 160, max_wall_minutes: 90, max_concurrent_evaluations: 3 },
      { kind: 'hybrid', llm_share: 0.75, breadth: 'sonnet', depth: 'opus', depth_share: 0.2, depth_thinking: true, batch_mode: true },
    );
  });

  it('AST-only mode disables the LLM fields and writes zero LLM calls', async () => {
    const create = stubCreate({ ok: true, definitionFile: 'a.discovery.yaml' });
    renderOn(<NewDiscoveryWizard />);
    fireEvent.click(screen.getByRole('tab', { name: /AST only/ }));
    expect((screen.getByLabelText('Breadth model') as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'ast run' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create discovery' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const calls = create.mock.calls as unknown as Array<[string, string, { max_llm_calls: number }, { kind: string }]>;
    expect(calls[0][2].max_llm_calls).toBe(0);
    expect(calls[0][3].kind).toBe('ast');
  });

  it('clamps out-of-range budgets instead of sending them', async () => {
    const create = stubCreate({ ok: true, definitionFile: 'a.discovery.yaml' });
    renderOn(<NewDiscoveryWizard />);
    const concurrency = screen.getByLabelText('Concurrent evaluations');
    fireEvent.change(concurrency, { target: { value: '99' } });
    fireEvent.blur(concurrency);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create discovery' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const calls = create.mock.calls as unknown as Array<[string, string, { max_concurrent_evaluations: number }]>;
    expect(calls[0][2].max_concurrent_evaluations).toBe(8);
  });

  it('shows the store error (for example a name collision) and stays open', async () => {
    stubCreate({ ok: false, error: 'experiments/x.discovery.yaml already exists. Choose another name.' });
    renderOn(<NewDiscoveryWizard />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create discovery' }));
    expect((await screen.findByRole('alert')).textContent).toContain('already exists');
  });

  it('Cancel closes the wizard', () => {
    useDiscoveryStore.setState({ wizardOpen: true });
    renderOn(<NewDiscoveryWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useDiscoveryStore.getState().wizardOpen).toBe(false);
  });
});
