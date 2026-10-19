import { describe, it, expect, vi } from 'vitest';
import { buildCommands, type CommandActions, type CommandContext } from './CommandPalette';
import {
  PANEL_REGISTRY,
  leftPanelsForMode,
} from '../../layout/panelRegistry';
import type { WorkspaceMode } from '../../stores/workspaceStore';
import { KEYBINDINGS } from '../../config/keybindings';
import { shortcutGroups } from '../onboarding/KeyboardShortcuts';

function noop() {}

function makeActions(overrides: Partial<CommandActions> = {}): CommandActions {
  return {
    run: noop, openFile: noop, saveFile: noop, newFile: noop, toggleTheme: noop,
    toggleDirac: noop, focusDirac: noop, openWhatsNew: noop, cycleMode: noop, toggleShortcuts: noop, switchWorkspaceMode: noop,
    startResearchTour: noop, navigate: noop, togglePanel: noop, runExperiment: noop,
    openRunFolder: noop, setLayoutPreset: noop, ...overrides,
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

  it('lists "Replay Research tour" only in Research mode (shell-12)', () => {
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

import { panelToggleLabel } from './panelLabels';

describe('layout and mode-scoped commands (S-18)', () => {
  it('lists the Stim-only QEC panel toggles only in Research', () => {
    const qec = ['toggle-panel-qecTimeline', 'toggle-panel-qecLattice', 'toggle-panel-qecDetectorGraph'];
    const learn = new Set(buildCommands(makeActions(), makeContext({ mode: 'learn' })).map((c) => c.id));
    const research = new Set(buildCommands(makeActions(), makeContext({ mode: 'research' })).map((c) => c.id));
    for (const id of qec) {
      expect(learn.has(id)).toBe(false);
      expect(research.has(id)).toBe(true);
    }
  });

  it('adds Layout: Clean / Balanced / Full commands findable by "layout" or "preset"', () => {
    const setLayoutPreset = vi.fn();
    const commands = buildCommands(makeActions({ setLayoutPreset }), makeContext());
    for (const [id, label, preset] of [
      ['layout-clean', 'Layout: Clean', 'clean'],
      ['layout-balanced', 'Layout: Balanced', 'balanced'],
      ['layout-full', 'Layout: Full', 'full'],
    ] as const) {
      const cmd = commands.find((c) => c.id === id);
      expect(cmd?.label).toBe(label);
      expect(cmd?.keywords).toEqual(expect.arrayContaining(['layout', 'preset']));
      cmd?.action();
      expect(setLayoutPreset).toHaveBeenLastCalledWith(preset);
    }
  });
});

describe('panelToggleLabel', () => {
  it('does not repeat the word panel', () => {
    expect(panelToggleLabel('Terminal panel')).toBe('Toggle terminal panel');
    expect(panelToggleLabel('Circuit')).toBe('Toggle circuit panel');
  });

  it('is sentence case but keeps proper nouns', () => {
    expect(panelToggleLabel('Bloch Sphere')).toBe('Toggle Bloch sphere panel');
    expect(panelToggleLabel('Code Lattice')).toBe('Toggle code lattice panel');
  });
});


/** Palette command id -> the keybinding it performs. The label comes from the registry, so palette, sheet and status bar agree. */
const BOUND_COMMANDS: Record<string, string> = {
  'workspace-mode': 'switch-workspace',
  run: 'run',
  open: 'open',
  save: 'save',
  new: 'new',
  theme: 'toggle-theme',
  mode: 'cycle-ui-mode',
  dirac: 'toggle-dirac',
  'dirac-focus': 'focus-dirac',
  shortcuts: 'shortcuts',
  'goto-settings': 'settings',
  'toggle-panel-terminal': 'toggle-bottom-panel',
};

describe('framework-gated panel toggles', () => {
  const toggles = (framework: CommandContext['framework']) =>
    buildCommands(makeActions(), makeContext({ framework })).filter((c) => c.id.startsWith('toggle-panel-')).map((c) => c.label);

  it('hides Stim-only panels for a Qiskit file', () => {
    const labels = toggles('qiskit');
    expect(labels).not.toContain('Toggle code lattice panel');
    expect(labels).not.toContain('Toggle detector graph panel');
  });

  it('offers Stim-only panels for a Stim file and when no framework is known', () => {
    expect(toggles('stim')).toContain('Toggle code lattice panel');
    expect(toggles(null)).toContain('Toggle code lattice panel');
    expect(toggles(undefined)).toContain('Toggle code lattice panel');
  });
});

describe('one name for every command (palette, shortcuts sheet, registry)', () => {
  const all = (mode: WorkspaceMode) => buildCommands(makeActions(), makeContext({ mode, developerViews: true, hasSelectedRun: true }));

  it.each(['learn', 'research'] as const)('%s: a bound command reads exactly like its keybinding label', (mode) => {
    const commands = all(mode);
    for (const [commandId, bindingId] of Object.entries(BOUND_COMMANDS)) {
      const command = commands.find((c) => c.id === commandId);
      if (!command) continue; // not offered in this mode
      const binding = KEYBINDINGS.find((b) => b.id === bindingId);
      if (commandId === 'goto-settings') expect(command.shortcut).toBe('⌘,');
      expect(command.label, commandId).toBe(binding?.label);
    }
  });

  it('every palette label that has a sheet row is spelled identically in the sheet', () => {
    const sheet = new Set(shortcutGroups(true, false).flatMap((g) => g.shortcuts.map((s) => s.description)));
    const commands = all('learn');
    for (const id of ['run', 'open', 'save', 'new', 'theme', 'mode', 'dirac', 'dirac-focus', 'workspace-mode', 'shortcuts']) {
      const command = commands.find((c) => c.id === id);
      expect(sheet.has(command?.label ?? ''), `${id}: "${command?.label}"`).toBe(true);
    }
  });

  const PROPER_NOUNS = new Set([
    'Dirac', 'Python', 'Qiskit', 'Learn', 'Research', 'QEC', 'Bloch', 'Go', 'Layout',
    // Names of surfaces a command navigates to (the rail's own labels).
    'Explorer', 'Learning', 'Experiments', 'Challenges', 'Hardware', 'Resource', 'Estimator', 'Transpiler',
    'Histogram', 'Launch', 'Community', 'Plugins', 'Search', 'Circuit', 'Settings', 'Workbench', 'Clean', 'Balanced', 'Full', "What's", 'New',
  ]);

  it.each(['learn', 'research'] as const)('%s: labels are sentence case (no second capitalised word outside proper nouns)', (mode) => {
    const offenders = all(mode)
      .flatMap((c) => c.label.split(/\s+/).slice(1).filter((w) => /^[A-Z][a-z]/.test(w.replace(/^\(/, '')) && !PROPER_NOUNS.has(w.replace(/[():/,]/g, ''))).map((w) => `${c.label} -> ${w}`));
    expect(offenders).toEqual([]);
  });

  it('names the two histogram surfaces by what they are, not by where they sit', () => {
    const labels = all('research').map((c) => c.label);
    expect(labels).toContain('Toggle histogram chip');
    expect(labels).toContain('Toggle histogram tab');
    expect(labels.some((l) => /\(inline\)|\(bottom panel\)/.test(l))).toBe(false);
  });
});

describe('palette Go-to follows the rail the person sees (shell-r6-03)', () => {
  it('Beginner has no Go to Explorer, and Learning is Cmd+1', () => {
    const commands = buildCommands(makeActions(), makeContext({ mode: 'learn', explorerSidebar: false }));
    expect(commands.some((c) => c.id === 'goto-files')).toBe(false);
    expect(commands.find((c) => c.id === 'goto-learning')?.shortcut).toBe('⌘1');
    expect(commands.find((c) => c.id === 'goto-challenges')?.shortcut).toBe('⌘2');
  });

  it('hides the Layout presets when the status bar cannot show them (Learn Beginner)', () => {
    const labels = (c: CommandContext) => buildCommands(makeActions(), c).map((x) => x.label);
    expect(labels(makeContext({ layoutPresets: false })).some((l) => l.startsWith('Layout:'))).toBe(false);
    expect(labels(makeContext()).filter((l) => l.startsWith('Layout:'))).toHaveLength(3);
  });

  it('files Replay Research tour under Help', () => {
    const tour = buildCommands(makeActions(), makeContext()).find((c) => c.id === 'research-tour');
    expect(tour?.category).toBe('Help');
  });
});

describe('buildCommands while a lesson or challenge owns the main area', () => {
  const ids = (mainTakeover: CommandContext['mainTakeover'], mode: WorkspaceMode = 'learn') =>
    buildCommands(makeActions(), makeContext({ mode, mainTakeover, layoutPresets: true })).map((c) => c.id);
  const EDITOR_ONLY = ['run', 'new', 'open', 'save', 'step-through', 'reset-step', 'layout-clean', 'toggle-panel-terminal', 'toggle-panel-circuit'];

  it.each(['lesson', 'challenge'] as const)('omits every editor-only command in a %s', (kind) => {
    const present = ids(kind);
    for (const id of EDITOR_ONLY) expect(present).not.toContain(id);
    expect(present.some((id) => id.startsWith('toggle-panel-'))).toBe(false);
  });

  it('keeps navigation, theme, Dirac and help available', () => {
    const present = ids('lesson');
    for (const id of ['workspace-mode', 'theme', 'dirac', 'shortcuts', 'goto-learning']) expect(present).toContain(id);
  });

  it('offers the editor commands again when nothing owns the area', () => {
    const present = ids(null);
    for (const id of ['run', 'new', 'open', 'save', 'step-through', 'toggle-panel-terminal']) expect(present).toContain(id);
  });

  it('leaves a Research takeover like the QEC Workbench alone', () => {
    expect(ids('qec', 'research')).toContain('run');
  });
});
