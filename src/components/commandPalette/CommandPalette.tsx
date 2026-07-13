import { useState, useRef, useEffect, useMemo } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { EASING, DURATION, getDuration, prefersReducedMotion } from '../../lib/animations';
import {
  PANEL_REGISTRY,
  leftPanelsForMode,
  bottomLeftPanelsForMode,
  leftPanelLabel,
  type PanelId,
  type LeftPanelId,
} from '../../layout/panelRegistry';
import type { WorkspaceMode } from '../../stores/workspaceStore';

export interface Command {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    return commands.filter((c) =>
      fuzzyMatch(query, c.label) || fuzzyMatch(query, c.category)
    );
  }, [query, commands]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- resets index on query change
  useEffect(() => { setSelectedIdx(0); }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIdx] as HTMLElement;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIdx]) {
        filtered[selectedIdx].action();
        onClose();
      }
    }
  };

  const categoryColors: Record<string, string> = {
    File: '#98C379',
    Edit: '#D19A66',
    View: '#48CAE4',
    Run: '#00B4D8',
    Dirac: '#7B2D8E',
    Circuit: '#E06C75',
    Learn: '#10B981',
    Settings: '#6A737D',
    Go: '#48CAE4',
    Experiment: '#B78AF0',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(12px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '15vh',
        animation: prefersReducedMotion() ? 'none' : `nuclei-fade-in ${DURATION.fast}ms`,
      }}
      onClick={onClose}
      role="dialog"
      aria-label="Command palette"
      aria-modal="true"
    >
      <div
        style={{
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          width: '100%', maxWidth: 520, maxHeight: '50vh',
          overflow: 'hidden',
          boxShadow: shadow.lg,
          animation: prefersReducedMotion() ? 'none' : `nuclei-slide-down ${DURATION.normal}ms ${EASING.spring}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${colors.border}` }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            style={{
              width: '100%', background: 'transparent',
              border: 'none', outline: 'none',
              color: colors.text, fontSize: 15,
              fontFamily: "'Geist Sans', Inter, sans-serif",
            }}
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
          />
        </div>

        {/* Results */}
        <div ref={listRef} id="command-list" style={{ maxHeight: '40vh', overflow: 'auto', padding: '4px 0' }} role="listbox">
          {filtered.length === 0 ? (
            <div style={{ padding: 16, color: colors.textMuted, fontSize: 13, fontFamily: "'Geist Sans', sans-serif", textAlign: 'center' }}>
              No matching commands
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                onClick={() => { cmd.action(); onClose(); }}
                style={{
                  display: 'flex', alignItems: 'center',
                  width: '100%', padding: '8px 16px',
                  background: i === selectedIdx ? colors.border : 'transparent',
                  border: 'none', cursor: 'pointer',
                  color: colors.text, fontSize: 13,
                  fontFamily: "'Geist Sans', Inter, sans-serif",
                  textAlign: 'left', gap: 10,
                  transition: `background ${getDuration(DURATION.instant)}ms`,
                }}
                role="option"
                aria-selected={i === selectedIdx}
              >
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  color: categoryColors[cmd.category] ?? colors.textMuted,
                  minWidth: 48, fontFamily: "'Geist Sans', sans-serif",
                }}>
                  {cmd.category}
                </span>
                <span style={{ flex: 1 }}>{cmd.label}</span>
                {cmd.shortcut && (
                  <kbd style={{
                    fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
                    color: colors.textMuted, background: colors.bgPanel,
                    padding: '1px 6px', borderRadius: 3,
                    border: `1px solid ${colors.border}`,
                  }}>
                    {cmd.shortcut}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** ⌘1..9 map onto the first nine top-rail views, in registry order (PRD 11
 * Phase D). Exported so App.tsx binds the same mapping the palette displays. */
// eslint-disable-next-line react-refresh/only-export-components
export function railShortcutFor(index: number): string | undefined {
  return index < 9 ? `⌘${index + 1}` : undefined;
}

export interface CommandContext {
  mode: WorkspaceMode;
  developerViews: boolean;
  /** Discovered experiments, for "Run experiment <name>". */
  experiments: ReadonlyArray<{ fileName: string; name: string }>;
  /** Whether a run is selected (enables "Open run folder"). */
  hasSelectedRun: boolean;
}

export interface CommandActions {
  run: () => void;
  openFile: () => void;
  saveFile: () => void;
  newFile: () => void;
  toggleTheme: () => void;
  toggleDirac: () => void;
  cycleMode: () => void;
  toggleShortcuts: () => void;
  switchWorkspaceMode: () => void;
  startResearchTour: () => void;
  /** Open a rail view (navigationStore.setActiveView). */
  navigate: (view: LeftPanelId) => void;
  /** Flip a viz/bottom panel's visibility (layoutStore.togglePanel). */
  togglePanel: (id: PanelId) => void;
  /** Start a discovered experiment by its yaml file name. */
  runExperiment: (fileName: string) => void;
  /** Reveal the selected run's folder in the OS file manager. */
  openRunFolder: () => void;
}

/**
 * Build the palette's command list from the panel registry + current context
 * (PRD 11 Phase D). Registry-driven so the palette can never drift from the
 * rail: every view a mode offers gets a "Go to …", every viz/bottom panel a
 * mode offers gets a "Toggle …" — asserted by the palette↔registry parity
 * test. Static app commands (Run/File/Dirac/…) follow.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function buildCommands(actions: CommandActions, context: CommandContext): Command[] {
  const commands: Command[] = [];

  // Workspace + orientation.
  commands.push({ id: 'workspace-mode', label: 'Switch workspace mode (Learn/Research)', category: 'Go', shortcut: '⌘⇧M', action: actions.switchWorkspaceMode });
  commands.push({ id: 'research-tour', label: 'Replay the Research mode tour', category: 'Go', action: actions.startResearchTour });

  // Go to <view> — every rail view this mode offers, in registry order.
  const views = leftPanelsForMode(context.mode, { developerViews: context.developerViews });
  const bottomPinned = new Set(bottomLeftPanelsForMode(context.mode));
  let railIndex = 0;
  for (const view of views) {
    const isTop = !bottomPinned.has(view);
    const shortcut = isTop ? railShortcutFor(railIndex) : undefined;
    if (isTop) railIndex += 1;
    commands.push({
      id: `goto-${view}`,
      label: `Go to ${leftPanelLabel(view)}`,
      category: 'Go',
      shortcut,
      action: () => actions.navigate(view),
    });
  }

  // Toggle <panel> — every viz/bottom panel this mode offers.
  for (const panel of PANEL_REGISTRY) {
    if (!panel.modes.includes(context.mode)) continue;
    commands.push({
      id: `toggle-panel-${panel.id}`,
      label: `Toggle ${panel.title} panel`,
      category: 'View',
      action: () => actions.togglePanel(panel.id),
    });
  }

  // Run experiment <name> (Research) — fuzzy-matchable by the experiment name.
  for (const exp of context.experiments) {
    commands.push({
      id: `run-exp-${exp.fileName}`,
      label: `Run experiment: ${exp.name}`,
      category: 'Experiment',
      action: () => actions.runExperiment(exp.fileName),
    });
  }
  if (context.hasSelectedRun) {
    commands.push({ id: 'open-run-folder', label: 'Open run folder', category: 'Experiment', action: actions.openRunFolder });
  }

  // Static app commands.
  commands.push(
    { id: 'run', label: 'Run Circuit', category: 'Run', shortcut: '⌘+Enter', action: actions.run },
    { id: 'open', label: 'Open File', category: 'File', shortcut: '⌘+O', action: actions.openFile },
    { id: 'save', label: 'Save File', category: 'File', shortcut: '⌘+S', action: actions.saveFile },
    { id: 'new', label: 'New File', category: 'File', shortcut: '⌘+N', action: actions.newFile },
    { id: 'theme', label: 'Toggle Theme', category: 'View', shortcut: '⌘+Shift+T', action: actions.toggleTheme },
    { id: 'mode', label: 'Cycle UI Mode (Beginner/Intermediate/Advanced)', category: 'View', shortcut: '⌘+Shift+L', action: actions.cycleMode },
    { id: 'dirac', label: 'Toggle Dirac Panel', category: 'Dirac', shortcut: '⌘+D', action: actions.toggleDirac },
    { id: 'dirac-focus', label: 'Focus Dirac Input', category: 'Dirac', shortcut: '⌘+L', action: actions.toggleDirac },
    { id: 'step-through', label: 'Step Through Circuit', category: 'Circuit', action: () => {
      import('../../stores/circuitStore').then(({ useCircuitStore }) => {
        useCircuitStore.getState().setStepMode(true);
      });
    }},
    { id: 'reset-step', label: 'Reset Step-Through', category: 'Circuit', action: () => {
      import('../../stores/circuitStore').then(({ useCircuitStore }) => {
        useCircuitStore.getState().setStepMode(false);
      });
    }},
    { id: 'exercise', label: 'Start Exercise (via Dirac)', category: 'Learn', action: actions.toggleDirac },
    { id: 'shortcuts', label: 'Keyboard Shortcuts', category: 'Settings', shortcut: '⌘+/', action: actions.toggleShortcuts },
  );

  return commands;
}
