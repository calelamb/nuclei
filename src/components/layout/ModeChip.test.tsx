// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';
import { ModeChip } from './ModeChip';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useModeSwitchStore } from '../../stores/modeSwitchStore';
import { useExperimentRunStore } from '../../stores/experimentRunStore';

afterEach(() => cleanup());

describe('<ModeChip> (PRD 11 Phase B)', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ mode: 'learn' });
    useExperimentRunStore.setState({ active: null });
    useModeSwitchStore.setState({ pending: null, announcement: '' });
  });

  it('shows the active mode label and is the switch control', () => {
    const { getByRole } = render(<ModeChip />);
    const chip = getByRole('button', { name: 'Switch workspace mode' });
    expect(chip.textContent).toBe('LEARN');
    expect(chip.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('opens a menu with both modes, current one checked', () => {
    const { getByRole } = render(<ModeChip />);
    fireEvent.click(getByRole('button', { name: 'Switch workspace mode' }));
    const menu = getByRole('menu', { name: 'Switch workspace mode' });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items).toHaveLength(2);
    // Learn is current → checked.
    const learn = within(menu).getByText('Learn quantum computing').closest('button')!;
    expect(learn.getAttribute('aria-checked')).toBe('true');
  });

  it('picking Research switches immediately when nothing is running', () => {
    const { getByRole, getByText } = render(<ModeChip />);
    fireEvent.click(getByRole('button', { name: 'Switch workspace mode' }));
    fireEvent.click(getByText('Research workspace'));
    expect(useWorkspaceStore.getState().mode).toBe('research');
    // Menu closed.
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('picking a mode while a run is active stages a confirm instead of switching', () => {
    useExperimentRunStore.setState({
      active: {
        experimentName: 'theta-sweep',
        experimentFileName: 'theta-sweep.experiment.yaml',
        cancel: () => {},
        progress: { completed: 1, total: 4, failures: 0, currentPoint: 1 },
      },
    });
    const { getByRole, getByText } = render(<ModeChip />);
    fireEvent.click(getByRole('button', { name: 'Switch workspace mode' }));
    fireEvent.click(getByText('Research workspace'));
    // Did NOT switch — a confirm is staged in the store.
    expect(useWorkspaceStore.getState().mode).toBe('learn');
    expect(useModeSwitchStore.getState().pending?.runningName).toBe('theta-sweep');
  });
});
