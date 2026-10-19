import { panelToggleLabel } from './panelLabels';
import { useState, useRef, useEffect, useMemo, useId } from 'react';
import { Search } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { groupByCategory } from './groupCommands';
import { useEdgeFades } from '../circuit/edgeFades';
import { useThemeStore } from '../../stores/themeStore';
import { EASING, DURATION, getDuration, prefersReducedMotion } from '../../lib/animations';
import {
  PANEL_REGISTRY,
  railViewsFor,
  bottomLeftPanelsForMode,
  leftPanelLabel,
  panelPassesFramework,
  type PanelId,
  type LeftPanelId,
} from '../../layout/panelRegistry';
import type { WorkspaceMode } from '../../stores/workspaceStore';
import type { MainTakeover } from '../../layout/takeover';
import type { Framework } from '../../types/quantum';
import type { LayoutPreset } from '../../stores/layoutStore';
import { rankCommands } from './rankCommands';
import { shortcutLabel, isMacPlatform, bindingLabel, railShortcutLabel } from '../../config/keybindings';

import { TYPOGRAPHY } from '../../styles/tokens';
import { closeActiveTooltip } from '../ui/tooltipSingleton';
import { runShortcutHiddenEditor } from '../../config/runShortcut';
import { isLearnEnabled } from '../../stores/learnGateStore';
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
/** A whole number of rows: a clipped half-row at the bottom reads as a layout bug, so the edge fades instead. */
const LIST_MAX_HEIGHT = ROW_HEIGHT * VISIBLE_ROWS;

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);

  const listId = useId();
  const { ref: listFadeRef, onScroll: onListScroll, style: listFadeStyle } = useEdgeFades<HTMLDivElement>();

  // Focus stays on the input (the combobox); the trap keeps Tab inside and hands focus back to
  // whatever had it (the editor, a button) when the palette closes.
  useFocusTrap(panelRef, { autoFocus: false, restoreFocus: true });
  useEffect(() => { closeActiveTooltip(); inputRef.current?.focus(); }, []);

  const searching = query.trim() !== '';
  // Unfiltered: grouped under one header per category. Searching: a flat list ranked by relevance.
  const groups = useMemo(() => (searching ? null : groupByCategory(commands)), [searching, commands]);
  const filtered = useMemo(
    () => (groups ? groups.flatMap((g) => g.commands) : rankCommands(commands, query)),
    [groups, commands, query],
  );

  useEffect(() => { setSelectedIdx(0); }, [query]);

  const activeId = filtered[selectedIdx] ? `${listId}-${filtered[selectedIdx].id}` : undefined;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const run = (cmd: Command) => {
    onClose();
    requestAnimationFrame(cmd.action);
  };

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
      if (filtered[selectedIdx]) run(filtered[selectedIdx]);
    }
  };

  const renderRow = (cmd: Command, i: number, showCategory: boolean) => (
    <button
      key={cmd.id}
      id={`${listId}-${cmd.id}`}
      tabIndex={-1}
      onMouseMove={() => { if (i !== selectedIdx) setSelectedIdx(i); }}
      onClick={() => run(cmd)}
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
      <span style={{ flex: 1 }}>{cmd.label}</span>
      {showCategory && (
        <span style={{ fontSize: 11, color: colors.textDim, fontFamily: TYPOGRAPHY.fontSans }}>{cmd.category}</span>
      )}
      {cmd.shortcut && (
        <kbd style={{
          fontSize: 11, fontFamily: TYPOGRAPHY.fontMono,
          color: colors.textMuted, background: colors.bgPanel,
          padding: '1px 6px', borderRadius: 4,
          border: `1px solid ${colors.border}`,
        }}>
          {cmd.shortcut}
        </kbd>
      )}
    </button>
  );

  let rowIndex = 0;

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
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        tabIndex={-1}
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
        {/* Search field */}
        <div style={{ padding: 12, borderBottom: `1px solid ${colors.border}` }}>
          <div
            className="nuclei-field-group"
            style={{
              display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px',
              background: colors.bgElevated, border: `1px solid ${colors.borderStrong}`, borderRadius: 8,
            }}
          >
            <Search data-search-icon="" size={14} strokeWidth={1.75} color={colors.textDim} aria-hidden="true" style={{ flexShrink: 0 }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a command..."
              style={{
                flex: 1, minWidth: 0, background: 'transparent',
                border: 'none',
                color: colors.text, fontSize: 14,
                fontFamily: TYPOGRAPHY.fontSans,
              }}
              aria-label="Search commands"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
            />
          </div>
        </div>

        {/* Results */}
        <div id={listId} ref={listFadeRef} onScroll={onListScroll} style={{ ...listFadeStyle, maxHeight: LIST_MAX_HEIGHT, overflow: 'auto', padding: '4px 0' }} role="listbox" aria-label="Commands" tabIndex={-1} onFocus={(e) => { if (e.target === e.currentTarget) inputRef.current?.focus(); }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 16, color: colors.textMuted, fontSize: 13, fontFamily: TYPOGRAPHY.fontSans, textAlign: 'center' }}>
              No matching commands
            </div>
          ) : groups ? (
            groups.map((group) => (
              <div key={group.category} role="group" aria-label={group.category}>
                <div role="presentation" className="nuclei-overline" style={{ padding: '8px 16px 4px' }}>
                  {group.category}
                </div>
                {group.commands.map((cmd) => renderRow(cmd, rowIndex++, false))}
              </div>
            ))
          ) : (
            filtered.map((cmd, i) => renderRow(cmd, i, true))
          )}
        </div>
      </div>
    </div>
  );
}

export interface CommandContext {
  mode: WorkspaceMode;
  developerViews: boolean;
  /** Learn Beginner has no Explorer sidebar; Go to Explorer and the numbering skip it. Defaults to true. */
  explorerSidebar?: boolean;
  /** Whether the status bar shows the layout switcher (Learn Beginner hides it); the Layout commands follow. Defaults to true. */
  layoutPresets?: boolean;
  /** Discovered experiments, for "Run experiment <name>". */
  experiments: ReadonlyArray<{ fileName: string; name: string }>;
  /** Whether a run is selected (enables "Open run folder"). */
  hasSelectedRun: boolean;
  /** Active framework; panels whose affinity excludes it are not offered. Omit/null = offer all. */
  framework?: Framework | null;
  /**
   * The full-width view that owns the main area. While a lesson or challenge does, the editor, its panels and the
   * circuit are not on screen, so commands that act on them are not offered.
   */
  mainTakeover?: MainTakeover | null;
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
  /** Flip a viz/bottom panel against its resolved visibility (togglePanelResolved). */
  togglePanel: (id: PanelId) => void;
  /** Start a discovered experiment by its yaml file name. */
  runExperiment: (fileName: string) => void;
  /** Reveal the selected run's folder in the OS file manager. */
  openRunFolder: () => void;
  /** Switch the layout preset (layoutStore.setPreset). */
  setLayoutPreset: (preset: LayoutPreset) => void;
}

/** Step-through acts on the circuit diagram, so it is only offered while the editor is on screen. */
function stepCommands(): Command[] {
  const setStepMode = (on: boolean) => () => {
    void import('../../stores/circuitStore').then(({ useCircuitStore }) => {
      useCircuitStore.getState().setStepMode(on);
    });
  };
  return [
    { id: 'step-through', label: 'Step through circuit', category: 'Circuit', action: setStepMode(true) },
    { id: 'reset-step', label: 'Reset step-through', category: 'Circuit', action: setStepMode(false) },
  ];
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
  const sc = (id: string) => shortcutLabel(id, mac, undefined, context.mode);

  // Workspace + orientation.
  if (isLearnEnabled()) commands.push({ id: 'workspace-mode', label: bindingLabel('switch-workspace'), category: 'Navigate', shortcut: sc('switch-workspace'), keywords: ['learn', 'research', 'workspace'], action: actions.switchWorkspaceMode });
  if (context.mode === 'research') {
    commands.push({ id: 'research-tour', label: 'Replay Research tour', category: 'Help', action: actions.startResearchTour });
  }

  // Go to <view> — every rail view this mode offers, in registry order.
  const views = railViewsFor(context.mode, { developerViews: context.developerViews, explorerSidebar: context.explorerSidebar ?? true });
  const bottomPinned = new Set(bottomLeftPanelsForMode(context.mode));
  let railIndex = 0;
  for (const view of views) {
    const isTop = !bottomPinned.has(view);
    const shortcut = view === 'settings' ? sc('settings') : isTop ? railShortcutLabel(railIndex, mac) : undefined;
    if (isTop) railIndex += 1;
    commands.push({
      id: `goto-${view}`,
      label: view === 'settings' ? bindingLabel('settings') : `Go to ${leftPanelLabel(view)}`,
      category: 'Navigate',
      shortcut,
      action: () => actions.navigate(view),
    });
  }

  const editorHidden = context.mainTakeover === 'lesson' || context.mainTakeover === 'challenge';

  // Toggle <panel> — every viz/bottom panel this mode offers.
  for (const panel of editorHidden ? [] : PANEL_REGISTRY) {
    if (!panel.modes.includes(context.mode)) continue;
    if (!panelPassesFramework(panel, context.framework ?? null)) continue;
    commands.push({
      id: `toggle-panel-${panel.id}`,
      label: panelToggleLabel(panel.title),
      category: 'View',
      shortcut: panel.id === 'terminal' ? sc('toggle-bottom-panel') : undefined,
      keywords: ['show', 'hide'],
      action: () => actions.togglePanel(panel.id),
    });
  }

  // Layout presets: one command each, findable by "layout" or "preset".
  // Only offered while the status bar can show the resulting preset.
  for (const [preset, label] of context.layoutPresets === false || editorHidden ? [] : [['clean', 'Clean'], ['balanced', 'Balanced'], ['full', 'Full']] as const) {
    commands.push({
      id: `layout-${preset}`,
      label: `Layout: ${label}`,
      category: 'View',
      keywords: ['layout', 'preset', 'panels', preset],
      action: () => actions.setLayoutPreset(preset),
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
    // Run acts on the editor buffer, which every main-area takeover hides (same rule as the global chord).
    ...(runShortcutHiddenEditor(context.mainTakeover ?? null) ? [] : [{ id: 'run', label: bindingLabel('run'), category: 'Run', shortcut: sc('run'), keywords: ['execute', 'simulate', 'play'], action: actions.run }]),
    // Open, Save and New act on the editor buffer, which a lesson or challenge hides.
    ...(editorHidden ? [] : [
      { id: 'open', label: bindingLabel('open'), category: 'File', shortcut: sc('open'), action: actions.openFile },
      { id: 'save', label: bindingLabel('save'), category: 'File', shortcut: sc('save'), action: actions.saveFile },
      { id: 'new', label: bindingLabel('new'), category: 'File', shortcut: sc('new'), action: actions.newFile },
    ]),
    { id: 'theme', label: bindingLabel('toggle-theme'), category: 'View', shortcut: sc('toggle-theme'), keywords: ['dark', 'light', 'appearance', 'color', 'mode'], action: actions.toggleTheme },
    ...(context.mode === 'learn'
      ? [{ id: 'mode', label: bindingLabel('cycle-ui-mode'), category: 'View', shortcut: sc('cycle-ui-mode'), keywords: ['beginner', 'intermediate', 'advanced', 'simple', 'cycle', 'ui mode'], action: actions.cycleMode }]
      : []),
    { id: 'dirac', label: bindingLabel('toggle-dirac'), category: 'Dirac', shortcut: sc('toggle-dirac'), keywords: ['ai', 'assistant', 'chat'], action: actions.toggleDirac },
    { id: 'dirac-focus', label: bindingLabel('focus-dirac'), category: 'Dirac', shortcut: sc('focus-dirac'), keywords: ['ai', 'assistant', 'chat', 'ask'], action: actions.focusDirac },
    ...(editorHidden ? [] : stepCommands()),
    { id: 'shortcuts', label: bindingLabel('shortcuts'), category: 'Help', shortcut: sc('shortcuts'), keywords: ['keys', 'hotkeys', 'bindings'], action: actions.toggleShortcuts },
    { id: 'whats-new', label: "What's New", category: 'Help', keywords: ['release', 'notes', 'changelog', 'version'], action: actions.openWhatsNew },
  );

  return commands;
}
