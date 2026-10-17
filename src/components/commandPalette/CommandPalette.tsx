import { panelToggleLabel } from './panelLabels';
import { useState, useRef, useEffect, useMemo, useId } from 'react';
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
import { rankCommands } from './rankCommands';
import { shortcutLabel, isMacPlatform } from '../../config/keybindings';

import { TYPOGRAPHY } from '../../styles/tokens';
export interface Command {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  /** Extra search terms (synonyms) that are not shown. */
  keywords?: string[];
  action: () => void;
}

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

const ROW_HEIGHT = 34;
const VISIBLE_ROWS = 9;

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);

  const listId = useId();

  // Focus the input on open, and hand focus back to whatever had it (the
  // editor, a button) when the palette closes — otherwise it falls to <body>.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  const filtered = useMemo(() => rankCommands(commands, query), [query, commands]);

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
      // Don't let this Enter reach document-level listeners (e.g. the Research
      // tour would otherwise treat it as "Next" the moment it starts).
      e.stopPropagation();
      if (filtered[selectedIdx]) {
        const { action } = filtered[selectedIdx];
        onClose();
        requestAnimationFrame(action);
      }
    }
  };

  const categoryColors: Record<string, string> = {
    File: colors.textMuted,
    Edit: colors.textMuted,
    View: colors.textMuted,
    Run: colors.accentText,
    Dirac: colors.diracText,
    Circuit: colors.textMuted,
    Learn: colors.textMuted,
    Settings: colors.textMuted,
    Help: colors.textMuted,
    Navigate: colors.textMuted,
    Experiment: colors.modeResearch,
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        background: colors.scrim,
        backdropFilter: 'blur(4px)',
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
          width: '100%', maxWidth: 520, maxHeight: '70vh',
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
            className="nuclei-bare-input"
            style={{
              width: '100%', background: 'transparent',
              border: 'none',
              color: colors.text, fontSize: 14,
              fontFamily: TYPOGRAPHY.fontSans,
            }}
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={filtered[selectedIdx] ? `${listId}-${filtered[selectedIdx].id}` : undefined}
          />
        </div>

        {/* Results */}
        <div ref={listRef} id={listId} style={{ maxHeight: ROW_HEIGHT * VISIBLE_ROWS + 8, overflow: 'auto', padding: '4px 0' }} role="listbox">
          {filtered.length === 0 ? (
            <div style={{ padding: 16, color: colors.textMuted, fontSize: 13, fontFamily: TYPOGRAPHY.fontSans, textAlign: 'center' }}>
              No matching commands
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                id={`${listId}-${cmd.id}`}
                tabIndex={-1}
                onMouseMove={() => { if (i !== selectedIdx) setSelectedIdx(i); }}
                onClick={() => { onClose(); requestAnimationFrame(cmd.action); }}
                style={{
                  display: 'flex', alignItems: 'center',
                  width: '100%', height: ROW_HEIGHT, padding: '0 16px',
                  background: i === selectedIdx ? 'var(--color-surface-overlay)' : 'transparent',
                  border: 'none', cursor: 'pointer',
                  color: colors.text, fontSize: 13,
                  fontFamily: TYPOGRAPHY.fontSans,
                  textAlign: 'left', gap: 10,
                  transition: `background ${getDuration(DURATION.instant)}ms`,
                }}
                role="option"
                aria-selected={i === selectedIdx}
              >
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  color: categoryColors[cmd.category] ?? colors.textMuted,
                  minWidth: 48, fontFamily: TYPOGRAPHY.fontSans,
                }}>
                  {cmd.category}
                </span>
                <span style={{ flex: 1 }}>{cmd.label}</span>
                {cmd.shortcut && (
                  <kbd style={{
                    fontSize: 11, fontFamily: TYPOGRAPHY.fontMono,
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
export function railShortcutFor(index: number, mac: boolean = isMacPlatform()): string | undefined {
  if (index >= 9) return undefined;
  return mac ? `⌘${index + 1}` : `Ctrl+${index + 1}`;
}

export interface CommandContext {
  mode: WorkspaceMode;
  developerViews: boolean;
  /** Discovered experiments, for "Run experiment <name>". */
  experiments: ReadonlyArray<{ fileName: string; name: string }>;
  /** Whether a run is selected (enables "Open run folder"). */
  hasSelectedRun: boolean;
  /** Render shortcut hints as glyphs (Mac) or words (Ctrl+...). Defaults to the host platform. */
  mac?: boolean;
}

export interface CommandActions {
  run: () => void;
  openFile: () => void;
  saveFile: () => void;
  newFile: () => void;
  toggleTheme: () => void;
  toggleDirac: () => void;
  /** Open Dirac if needed and focus its input. */
  focusDirac: () => void;
  cycleMode: () => void;
  toggleShortcuts: () => void;
  /** Re-open the What's New notes. */
  openWhatsNew: () => void;
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
  const mac = context.mac ?? isMacPlatform();
  const sc = (id: string) => shortcutLabel(id, mac);

  // Workspace + orientation.
  commands.push({ id: 'workspace-mode', label: 'Switch workspace mode (Learn/Research)', category: 'Navigate', shortcut: sc('switch-workspace'), keywords: ['learn', 'research', 'workspace'], action: actions.switchWorkspaceMode });
  if (context.mode === 'research') {
    commands.push({ id: 'research-tour', label: 'Replay the Research mode tour', category: 'Navigate', action: actions.startResearchTour });
  }

  // Go to <view> — every rail view this mode offers, in registry order.
  const views = leftPanelsForMode(context.mode, { developerViews: context.developerViews });
  const bottomPinned = new Set(bottomLeftPanelsForMode(context.mode));
  let railIndex = 0;
  for (const view of views) {
    const isTop = !bottomPinned.has(view);
    const shortcut = isTop ? railShortcutFor(railIndex, mac) : undefined;
    if (isTop) railIndex += 1;
    commands.push({
      id: `goto-${view}`,
      label: `Go to ${leftPanelLabel(view)}`,
      category: 'Navigate',
      shortcut,
      action: () => actions.navigate(view),
    });
  }

  // Toggle <panel> — every viz/bottom panel this mode offers.
  for (const panel of PANEL_REGISTRY) {
    if (!panel.modes.includes(context.mode)) continue;
    commands.push({
      id: `toggle-panel-${panel.id}`,
      label: panelToggleLabel(panel.title),
      category: 'View',
      keywords: ['show', 'hide'],
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
    { id: 'run', label: 'Run Circuit', category: 'Run', shortcut: sc('run'), keywords: ['execute', 'simulate', 'play'], action: actions.run },
    { id: 'open', label: 'Open File', category: 'File', shortcut: sc('open'), action: actions.openFile },
    { id: 'save', label: 'Save File', category: 'File', shortcut: sc('save'), action: actions.saveFile },
    { id: 'new', label: 'New File', category: 'File', shortcut: sc('new'), action: actions.newFile },
    { id: 'theme', label: 'Toggle Theme', category: 'View', shortcut: sc('toggle-theme'), keywords: ['dark', 'light', 'appearance', 'color', 'mode'], action: actions.toggleTheme },
    ...(context.mode === 'learn'
      ? [{ id: 'mode', label: 'Cycle UI Mode (Beginner/Intermediate/Advanced)', category: 'View', shortcut: sc('cycle-ui-mode'), keywords: ['beginner', 'advanced', 'simple'], action: actions.cycleMode }]
      : []),
    { id: 'dirac', label: 'Toggle Dirac Panel', category: 'Dirac', shortcut: sc('toggle-dirac'), keywords: ['ai', 'assistant', 'chat'], action: actions.toggleDirac },
    { id: 'dirac-focus', label: 'Focus Dirac Input', category: 'Dirac', shortcut: sc('focus-dirac'), keywords: ['ai', 'assistant', 'chat', 'ask'], action: actions.focusDirac },
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
    { id: 'shortcuts', label: 'Keyboard Shortcuts', category: 'Help', shortcut: sc('shortcuts'), keywords: ['keys', 'hotkeys', 'bindings'], action: actions.toggleShortcuts },
    { id: 'whats-new', label: "What's New", category: 'Help', keywords: ['release', 'notes', 'changelog', 'version'], action: actions.openWhatsNew },
  );

  return commands;
}
