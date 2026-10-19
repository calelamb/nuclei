// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { DefinitionPanel } from './DefinitionPanel';
import { NewDiscoveryWizard } from './NewDiscoveryWizard';
import { fixtureDefinition } from '../../services/discovery/fixtures';
import { TOY_EVALUATOR } from '../../services/discovery/testkit';
import { useDiscoveryStore } from '../../stores/discoveryStore';
import { useFrameworksStore } from '../../stores/frameworksStore';
import type { DiscoveryEvaluatorInfo } from '../../types/discovery';
import { renderOn, resetDiscoveryTestState } from './testUtils';

const QEC_UNAVAILABLE: DiscoveryEvaluatorInfo = {
  ...TOY_EVALUATOR,
  kind: 'qec_memory',
  available: false,
  missing: ['stim', 'pymatching'],
  install: { catalog_ids: ['stim', 'pymatching'], hint: "Install 'Stim' and 'PyMatching' from the Research catalog in Environment setup." },
};
const STATE_OK: DiscoveryEvaluatorInfo = { ...TOY_EVALUATOR, kind: 'state_synthesis', available: true };

beforeEach(() => resetDiscoveryTestState());
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  useFrameworksStore.setState({ modalOpen: false });
});

describe('wizard with an unavailable evaluator', () => {
  it('flags only the QEC template and keeps the others plain', () => {
    useDiscoveryStore.setState({ evaluators: [QEC_UNAVAILABLE, STATE_OK] });
    renderOn(<NewDiscoveryWizard />);
    const notices = screen.getAllByTestId('evaluator-unavailable');
    expect(notices).toHaveLength(1);
    expect(notices[0].textContent).toContain('Needs the QEC research pack (stim, pymatching)');
    expect(notices[0].textContent).toContain('Research catalog');
    // The template stays selectable: creating the files needs no packages.
    expect(screen.getAllByRole('radio')[0].textContent).toContain('QEC memory schedule');
  });

  it('shows no notice when the kernel reports everything available or sends no flag', () => {
    useDiscoveryStore.setState({ evaluators: [{ ...QEC_UNAVAILABLE, available: undefined, missing: undefined }] });
    renderOn(<NewDiscoveryWizard />);
    expect(screen.queryByTestId('evaluator-unavailable')).toBeNull();
  });

  it('opens the Environment installer from the notice on desktop', () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    useDiscoveryStore.setState({ evaluators: [QEC_UNAVAILABLE] });
    renderOn(<NewDiscoveryWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Environment setup' }));
    expect(useFrameworksStore.getState().modalOpen).toBe(true);
  });

  it('gives plain instructions and no button off desktop', () => {
    useDiscoveryStore.setState({ evaluators: [QEC_UNAVAILABLE] });
    renderOn(<NewDiscoveryWizard />);
    expect(screen.queryByRole('button', { name: 'Open Environment setup' })).toBeNull();
    expect(screen.getByTestId('evaluator-unavailable').textContent).toContain('Install');
  });
});

describe('definition panel with an unavailable evaluator', () => {
  const definition = fixtureDefinition({ evaluator: { kind: 'qec_memory', config: {} } });

  it('disables Start run and explains why', () => {
    useDiscoveryStore.setState({ evaluators: [QEC_UNAVAILABLE] });
    const start = vi.fn(async () => ({ ok: true as const, runId: 'r' }));
    useDiscoveryStore.setState({ startRun: start as never });
    renderOn(<DefinitionPanel definition={definition} />);
    const button = screen.getByRole('button', { name: /Start run/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Needs the QEC research pack (stim, pymatching)');
    expect(screen.getAllByText('Needs the QEC research pack (stim, pymatching)').length).toBeGreaterThan(0);
    fireEvent.click(button);
    expect(start).not.toHaveBeenCalled();
  });

  it('enables Start run when the evaluator is available', () => {
    useDiscoveryStore.setState({ evaluators: [{ ...QEC_UNAVAILABLE, available: true, missing: undefined, install: undefined }] });
    renderOn(<DefinitionPanel definition={definition} />);
    expect((screen.getByRole('button', { name: /Start run/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId('evaluator-unavailable')).toBeNull();
  });
});
