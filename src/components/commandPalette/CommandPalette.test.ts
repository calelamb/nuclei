import { describe, it, expect, vi } from 'vitest';
import { buildCommands, type CommandActions, type CommandContext } from './CommandPalette';
import {
  PANEL_REGISTRY,
  leftPanelsForMode,
} from '../../layout/panelRegistry';
import type { WorkspaceMode } from '../../stores/workspaceStore';

function noop() {}

function makeActions(overrides: Partial<CommandActions> = {}): CommandActions {
  return {
    run: noop, openFile: noop, saveFile: noop, newFile: noop, toggleTheme: noop,
    toggleDirac: noop, focusDirac: noop, openWhatsNew: noop, cycleMode: noop, toggleShortcuts: noop, switchWorkspaceMode: noop,
    startResearchTour: noop, navigate: noop, togglePanel: noop, runExperiment: noop,
    openRunFolder: noop, ...overrides,
  };
}

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return { mode: 'research', developerViews: false, experiments: [], hasSelectedRun: false, mac: true, ...overrides };
}

describe('buildCommands', () => {
  it('wires "Switch workspace mode" to switchWorkspaceMode with ⌘⇧M', () => {
    const switchWorkspaceMode = vi.fn();
    const commands = buildCommands(makeActions({ switchWorkspaceMode }), makeContext());
    const command = commands.find((c) => /switch workspace mode/i.test(c.label));
    expect(command?.shortcut).toBe('⌘⇧M');
    command?.action();
    expect(switchWorkspaceMode).toHaveBeenCalledTimes(1);
  });

  it('generates a "Run experiment" command per discovered experiment', () => {
    const runExperiment = vi.fn();
    const commands = buildCommands(
      makeActions({ runExperiment }),
      makeContext({ experiments: [{ fileName: 'theta.experiment.yaml', name: 'theta-sweep' }] }),
    );
    const cmd = commands.find((c) => c.id === 'run-exp-theta.experiment.yaml');
    expect(cmd?.label).toBe('Run experiment: theta-sweep');
    cmd?.action();
    expect(runExperiment).toHaveBeenCalledWith('theta.experiment.yaml');
  });

  it('offers "Cycle UI Mode" in Learn only (Research ignores UI mode)', () => {
    const learn = buildCommands(makeActions(), makeContext({ mode: 'learn' }));
    const research = buildCommands(makeActions(), makeContext({ mode: 'research' }));
    expect(learn.some((c) => c.id === 'mode')).toBe(true);
    expect(research.some((c) => c.id === 'mode')).toBe(false);
  });

  it('offers "Open run folder" only when a run is selected', () => {
    expect(buildCommands(makeActions(), makeContext({ hasSelectedRun: false })).find((c) => c.id === 'open-run-folder')).toBeUndefined();
    expect(buildCommands(makeActions(), makeContext({ hasSelectedRun: true })).find((c) => c.id === 'open-run-folder')).toBeDefined();
  });

  it('assigns ⌘1..9 to the first nine top-rail Go-to commands', () => {
    const commands = buildCommands(makeActions(), makeContext({ mode: 'research', developerViews: true }));
    const firstGoto = commands.find((c) => c.id.startsWith('goto-'));
    expect(firstGoto?.shortcut).toBe('⌘1');
  });
});

// The load-bearing PRD 11 Phase D guarantee: the palette can never drift from
// the panel registry. Every view a mode offers has a Go-to command; every
// viz/bottom panel a mode offers has a Toggle command.
describe('palette ↔ registry parity', () => {
  const MODES: WorkspaceMode[] = ['learn', 'research'];
  for (const mode of MODES) {
    for (const developerViews of [false, true]) {
      it(`${mode} (dev=${developerViews}): every rail view and panel has a command`, () => {
        const commands = buildCommands(makeActions(), makeContext({ mode, developerViews }));
        const ids = new Set(commands.map((c) => c.id));

        for (const view of leftPanelsForMode(mode, { developerViews })) {
          expect(ids.has(`goto-${view}`)).toBe(true);
        }
        for (const panel of PANEL_REGISTRY) {
          if (!panel.modes.includes(mode)) continue;
          expect(ids.has(`toggle-panel-${panel.id}`)).toBe(true);
        }
      });
    }
  }

  it('lists "Replay the Research mode tour" only in Research mode (shell-12)', () => {
    const research = buildCommands(makeActions(), makeContext({ mode: 'research' }));
    const learn = buildCommands(makeActions(), makeContext({ mode: 'learn' }));
    expect(research.some((c) => c.id === 'research-tour')).toBe(true);
    expect(learn.some((c) => c.id === 'research-tour')).toBe(false);
  });
});

describe('palette commands (shell-07, shell-13, shell-19)', () => {
  it('"Focus Dirac Input" focuses Dirac instead of toggling it closed', () => {
    const toggleDirac = vi.fn();
    const focusDirac = vi.fn();
    const cmd = buildCommands(makeActions({ toggleDirac, focusDirac }), makeContext()).find((c) => c.id === 'dirac-focus');
    cmd?.action();
    expect(focusDirac).toHaveBeenCalledTimes(1);
    expect(toggleDirac).not.toHaveBeenCalled();
  });

  it('drops the "Start Exercise (via Dirac)" command that only toggled Dirac', () => {
    const commands = buildCommands(makeActions(), makeContext({ mode: 'learn' }));
    expect(commands.some((c) => c.id === 'exercise')).toBe(false);
  });

  it('gives every command a unique label (the two histogram toggles used to collide)', () => {
    for (const mode of ['learn', 'research'] as const) {
      const labels = buildCommands(makeActions(), makeContext({ mode })).map((c) => c.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('shows Ctrl-style hints off Mac', () => {
    const cmd = buildCommands(makeActions(), makeContext({ mac: false })).find((c) => c.id === 'theme');
    expect(cmd?.shortcut).toBe('Ctrl+Shift+T');
  });

  it('adds a What\'s New command wired to openWhatsNew', () => {
    const openWhatsNew = vi.fn();
    buildCommands(makeActions({ openWhatsNew }), makeContext()).find((c) => c.id === 'whats-new')?.action();
    expect(openWhatsNew).toHaveBeenCalled();
  });
});
