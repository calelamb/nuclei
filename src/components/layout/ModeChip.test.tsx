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

  describe('keyboard operation (shell-22)', () => {
    const openMenu = () => {
      const utils = render(<ModeChip />);
      const chip = utils.getByRole('button', { name: 'Switch workspace mode' });
      fireEvent.click(chip);
      return { ...utils, chip, menu: utils.getByRole('menu', { name: 'Switch workspace mode' }) };
    };

    it('moves focus onto the current mode when the menu opens', () => {
      const { menu } = openMenu();
      const current = within(menu).getAllByRole('menuitemradio').find((el) => el.getAttribute('aria-checked') === 'true');
      expect(document.activeElement).toBe(current);
    });

    it('ArrowDown / ArrowUp move focus between items and wrap', () => {
      const { menu } = openMenu();
      const [learn, research] = within(menu).getAllByRole('menuitemradio');
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(research);
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(learn);
      fireEvent.keyDown(menu, { key: 'ArrowUp' });
      expect(document.activeElement).toBe(research);
    });

    it('Home and End jump to the first and last item', () => {
      const { menu } = openMenu();
      const [learn, research] = within(menu).getAllByRole('menuitemradio');
      fireEvent.keyDown(menu, { key: 'End' });
      expect(document.activeElement).toBe(research);
      fireEvent.keyDown(menu, { key: 'Home' });
      expect(document.activeElement).toBe(learn);
    });

    it('Escape closes the menu and returns focus to the chip', () => {
      const { menu, chip, queryByRole } = openMenu();
      fireEvent.keyDown(menu, { key: 'Escape' });
      expect(queryByRole('menu')).toBeNull();
      expect(document.activeElement).toBe(chip);
    });

    it('Enter on a focused item picks it', () => {
      const { menu } = openMenu();
      const research = within(menu).getAllByRole('menuitemradio')[1];
      research.focus();
      fireEvent.keyDown(research, { key: 'Enter' });
      fireEvent.click(research); // browsers dispatch click for Enter on a button
      expect(useWorkspaceStore.getState().mode).toBe('research');
    });
  });
});
