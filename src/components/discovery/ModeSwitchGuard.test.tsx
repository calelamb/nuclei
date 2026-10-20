// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '../../test/learnGateOn';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ModeSwitchDialog } from '../layout/ModeSwitchDialog';
import { useLabActivityStore } from '../../stores/labActivityStore';
import { useModeSwitchStore } from '../../stores/modeSwitchStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

beforeEach(() => {
  useWorkspaceStore.setState({ mode: 'research' });
  useLabActivityStore.setState({ discovery: null });
  useModeSwitchStore.setState({ pending: null, announcement: '' });
});
afterEach(() => cleanup());

describe('mode switch guard dialog for a running discovery', () => {
  it('names the run and the Discovery Engine, and leaving does not stop it', () => {
    useLabActivityStore.setState({ discovery: { runId: 'r', name: 'w-state', status: 'running', evaluations: 3, maxEvaluations: 50 } });
    render(<ModeSwitchDialog />);
    act(() => useModeSwitchStore.getState().requestSwitch('learn'));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Discovery run w-state');
    expect(dialog.textContent).toContain("the Discovery Engine just won't be visible in Learn");
    expect(useWorkspaceStore.getState().mode).toBe('research');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Learn' }));
    expect(useWorkspaceStore.getState().mode).toBe('learn');
    expect(useLabActivityStore.getState().discovery?.status).toBe('running');
  });
});
