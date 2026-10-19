import type { ReactNode } from 'react';
import { Circle, Sun, Moon, X, Command, SquareTerminal } from 'lucide-react';
import { usePlatform } from '../../platform/PlatformProvider';
import { usePreviewPending } from '../../layout/usePreviewPending';
import { useDisplaySnapshot } from '../../layout/useDisplaySnapshot';
import { useSimulationStore } from '../../stores/simulationStore';
import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';
import { TYPOGRAPHY } from '../../styles/tokens';
import { useUIModeStore, type UIMode } from '../../stores/uiModeStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useLearnGateStore } from '../../stores/learnGateStore';
import { useExperimentRunStore } from '../../stores/experimentRunStore';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { useExerciseStore } from '../../stores/exerciseStore';
import { useLayoutStore, type LayoutPreset } from '../../stores/layoutStore';
import { ModeChip } from './ModeChip';
import { LabStatusChips } from '../discovery/LabStatusChips';
import { IconButton, Menu, Tooltip, type MenuEntry } from '../ui';
import { isMacPlatform, shortcutLabel } from '../../config/keybindings';
import { useEditorFocusStore } from '../../stores/editorFocusStore';
import { compactTabFocusHint } from '../../lib/tabFocusHint';
import { useHelpOverlayStore } from '../../stores/helpOverlayStore';
import { useUiFeatures } from '../../hooks/useUiFeatures';
import { getKernelStatusModel, type KernelTone } from './kernelStatusModel';
import { focusKernelBanner, retryKernel } from '../../lib/kernelControl';
import { useMainAreaTakeover } from '../../layout/takeover';
import './statusBar.css';

/**
 * PRD 11 Phase A — the status bar, extracted VERBATIM from `PanelLayout.tsx`.
 *
 * This is a pure lift-and-shift: the markup, styles, store reads, and
 * handlers are byte-for-byte what lived inline in PanelLayout. The extraction
 * gives PRD 11 Phase B a canonical home for the mode chip, kernel state,
 * framework, and sweep/campaign progress slots. A render snapshot test
 * (`StatusBar.test.tsx`) proves the extracted component matches the pre-
 * extraction output.
 */

/** A status-bar menu trigger: sized like the chips, coloured and hovered by .statusbar-ctl. */
const MENU_TRIGGER_STYLE: React.CSSProperties = {
  padding: '0 8px', height: 20, border: 'none',
  cursor: 'pointer', fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, fontWeight: 500,
};

const STALE_STATS_TOOLTIP = 'From the last run';

/* ── Learn level picker ── */
const LEVEL_OPTIONS: ReadonlyArray<{ value: UIMode; label: string; hint: string }> = [
  { value: 'beginner', label: 'Beginner', hint: 'Editor and results only' },
  { value: 'intermediate', label: 'Intermediate', hint: 'Adds Explorer and hardware' },
  { value: 'advanced', label: 'Advanced', hint: 'Adds the Dirac agent' },
];

function UiLevelMenu() {
  const uiMode = useUIModeStore((s) => s.mode);
  const setMode = useUIModeStore((s) => s.setMode);
  const label = LEVEL_OPTIONS.find((o) => o.value === uiMode)?.label ?? uiMode;
  const entries: MenuEntry[] = LEVEL_OPTIONS.map((o) => ({
    id: o.value, label: o.label, hint: o.hint, checked: o.value === uiMode, onSelect: () => setMode(o.value),
  }));
  const cycleKeys = shortcutLabel('cycle-ui-mode');
  return (
    <Menu
      label="Level"
      placement="top-end"
      entries={entries}
      trigger={(p) => (
        <Tooltip label="Change level" shortcut={cycleKeys} placement="above">
          <button
            {...p}
            aria-label={`Level: ${label}`}
            className="statusbar-ctl"
            style={MENU_TRIGGER_STYLE}
          >
            Level: {label}
          </button>
        </Tooltip>
      )}
    />
  );
}

/* ── Layout Preset Switcher: a menu like Level, so it is exactly as wide as its label ── */
const PRESET_OPTIONS: ReadonlyArray<{ value: LayoutPreset; label: string; hint: string }> = [
  { value: 'clean', label: 'Clean', hint: 'Results appear after you run' },
  { value: 'balanced', label: 'Balanced', hint: 'Circuit and Bloch spheres from the start, at |0⟩' },
  { value: 'full', label: 'Full', hint: 'Adds the Terminal and Histogram tab' },
];

function LayoutPresetSwitcher() {
  const preset = useLayoutStore((s) => s.preset);
  const setPreset = useLayoutStore((s) => s.setPreset);
  const platform = usePlatform();

  const choose = async (next: LayoutPreset) => {
    setPreset(next);
    try { await platform.setStoredValue('layout_preset', next); } catch { /* non-critical persistence */ }
  };
  const label = PRESET_OPTIONS.find((o) => o.value === preset)?.label ?? preset;
  const entries: MenuEntry[] = PRESET_OPTIONS.map((o) => ({
    id: o.value, label: o.label, hint: o.hint, checked: o.value === preset, onSelect: () => { void choose(o.value); },
  }));

  return (
    <Menu
      label="Layout preset"
      placement="top-start"
      minWidth={260}
      entries={entries}
      trigger={(p) => (
        <Tooltip label="Layout preset" placement="above">
          <button
            {...p}
            aria-label={`Layout preset: ${label}`}
            className="statusbar-ctl"
            style={MENU_TRIGGER_STYLE}
          >
            Layout: {label}
          </button>
        </Tooltip>
      )}
    />
  );
}

function KernelDot({ color, pulse }: { color: string; pulse: boolean }) {
  return (
    <Circle
      size={6}
      fill={color}
      stroke="none"
      style={pulse ? { animation: 'nuclei-heartbeat 1.5s ease infinite' } : undefined}
      aria-hidden="true"
    />
  );
}

/**
 * Qubits and Depth describe the code before the last edit while the diagram is stale or
 * catching up. Staleness is a quieter text token (never opacity, which fails contrast) plus a tip.
 */
function StatSpan({ stale, color, children }: { stale: boolean; color: string; children: ReactNode }) {
  const span = <span style={{ color: stale ? 'var(--color-text-tertiary)' : color }}>{children}</span>;
  return stale ? <Tooltip label={STALE_STATS_TOOLTIP} placement="above">{span}</Tooltip> : span;
}

/* ── Status Bar ── */
export function StatusBar() {
  const { snapshot, stale } = useDisplaySnapshot();
  const previewPending = usePreviewPending();
  const statsStale = stale || previewPending;
  const isRunning = useSimulationStore((s) => s.isRunning);
  const result = useSimulationStore((s) => s.result);
  const lastRunFailed = useSimulationStore((s) => s.lastRunFailed);
  const lastRunNoCircuit = useSimulationStore((s) => s.lastRunNoCircuit);
  const lastRunStopped = useSimulationStore((s) => s.lastRunStopped);
  const kernelReady = useEditorStore((s) => s.kernelReady);
  const kernelStatus = useEditorStore((s) => s.kernelStatus);
  const kernelError = useEditorStore((s) => s.kernelError);
  const kernelProgress = useEditorStore((s) => s.kernelProgress);
  const kernelInstalling = useEditorStore((s) => s.kernelInstalling);
  const lastInstallMs = useEditorStore((s) => s.lastInstallMs);
  const colors = useThemeStore((s) => s.colors);
  const features = useUiFeatures();
  const editorFocused = useEditorFocusStore((s) => s.focused);
  const tabMovesFocus = useEditorFocusStore((s) => s.tabMovesFocus);
  const openPalette = useHelpOverlayStore((s) => s.setPaletteOpen);
  const themeMode = useThemeStore((s) => s.mode);
  const themeToggle = useThemeStore((s) => s.toggle);
  const workspaceMode = useWorkspaceStore((s) => s.mode);
  const learnEnabled = useLearnGateStore((s) => s.learnEnabled);
  const activeRun = useExperimentRunStore((s) => s.active);
  const campaignRunning = useQecCampaignStore((s) => s.running);
  const campaignProgress = useQecCampaignStore((s) => s.progress);
  const campaignName = useQecCampaignStore((s) => s.campaignName);
  const campaignResumable = useQecCampaignStore((s) => s.resumable);
  const platform = usePlatform();
  const takeover = useMainAreaTakeover();
  const exercise = useExerciseStore((s) => s.activeExercise);
  const endExercise = useExerciseStore((s) => s.endExercise);
  const kernelModel = getKernelStatusModel({
    kernelStatus,
    kernelReady,
    kernelError,
    kernelProgress,
    kernelInstalling,
    installMs: lastInstallMs,
    isRunning,
    lastRunFailed,
    lastRunNoCircuit,
    lastRunStopped,
    executionTimeMs: result ? result.execution_time_ms : null,
    isWeb: platform.getPlatform() === 'web',
  });
  const toneColor: Record<KernelTone, string> = {
    idle: colors.textMuted,
    busy: colors.warning,
    running: colors.accent,
    ok: colors.success,
    warn: colors.warning,
    error: colors.error,
  };

  // User-supplied names (experiment / campaign / exercise) must not push the
  // right-side kernel/theme controls off-screen — cap each and ellipsize.
  const truncName: React.CSSProperties = {
    maxWidth: 140,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    display: 'inline-block',
    verticalAlign: 'bottom',
  };

  const chipStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 6, height: 20, padding: '0 6px',
    fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, whiteSpace: 'nowrap',
  };


  return (
    <div style={{
      height: 24, backgroundColor: colors.bgPanel,
      display: 'flex', alignItems: 'center',
      padding: '0 8px', gap: 8,
      fontSize: 11, fontFamily: TYPOGRAPHY.fontSans,
      flexShrink: 0, zIndex: 10,
      borderTop: `1px solid ${colors.border}`,
    }} role="group" aria-label="Status bar">
      {/* Mode chip — far-left mode identity + switcher (PRD 11 Phase B). */}
      {/* With Learn gated off there is only Research, so there is nothing to switch. */}
      {learnEnabled && <ModeChip />}

      {/* Left side: editor stats and the layout preset only mean something while the editor is on screen. */}
      {!takeover && (
        <>
          <StatSpan stale={statsStale} color={colors.textMuted}>Qubits: {snapshot ? snapshot.qubit_count : '—'}</StatSpan>
          <StatSpan stale={statsStale} color={colors.textMuted}>Depth: {snapshot ? snapshot.depth : '—'}</StatSpan>
          {features.layoutPresets && <LayoutPresetSwitcher />}
        </>
      )}

      {exercise && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: colors.diracText, fontSize: 11, minWidth: 0 }}>
          <span style={truncName}>{exercise.title}</span>
          <IconButton size="sm" className="nuclei-statusbar-end" onClick={endExercise} aria-label="End exercise" tooltip={{ label: 'End exercise' }}>
            <X size={12} />
          </IconButton>
        </span>
      )}

      {/* PRD 09 Phase D — compact sweep indicator, Research mode only. */}
      {workspaceMode === 'research' && activeRun && (
        <span
          title={`${activeRun.experimentName}: ${activeRun.progress.completed}/${activeRun.progress.total} runs`}
          style={{ display: 'flex', alignItems: 'center', gap: 4, color: colors.accentText, fontSize: 11, minWidth: 0 }}
        >
          <Circle size={5} fill={colors.accent} stroke="none" style={{ animation: 'nuclei-heartbeat 1.5s ease infinite', flexShrink: 0 }} />
          <span style={truncName}>{activeRun.experimentName}</span>
          <span style={{ flexShrink: 0 }}>: {activeRun.progress.completed}/{activeRun.progress.total}
          {activeRun.progress.failures > 0 ? ` (${activeRun.progress.failures} failed)` : ''}</span>
        </span>
      )}

      {/* PRD 10 Phase E — QEC campaign chip (Research mode). Running progress
          from strong_id-keyed changed-row events, or a resumable prior run. */}
      {workspaceMode === 'research' && campaignRunning && campaignProgress && (
        <span
          title={`${campaignName ?? 'Campaign'}: ${campaignProgress.tasksComplete}/${campaignProgress.tasksTotal} tasks, ${campaignProgress.sampledShots.toLocaleString()} shots`}
          style={{ display: 'flex', alignItems: 'center', gap: 4, color: colors.modeResearch, fontSize: 11, minWidth: 0 }}
        >
          <Circle size={5} fill={colors.modeResearch} stroke="none" style={{ animation: 'nuclei-heartbeat 1.5s ease infinite', flexShrink: 0 }} />
          <span style={truncName}>{campaignName ?? 'campaign'}</span>
          <span style={{ flexShrink: 0 }}>: {campaignProgress.tasksComplete}/{campaignProgress.tasksTotal}</span>
        </span>
      )}
      {workspaceMode === 'research' && !campaignRunning && campaignResumable && (
        <span
          title={`${campaignResumable.name} was interrupted — resumable`}
          style={{ display: 'flex', alignItems: 'center', gap: 4, color: colors.warning, fontSize: 11, minWidth: 0 }}
        >
          <Circle size={5} fill={colors.warning} stroke="none" style={{ flexShrink: 0 }} />
          <span style={truncName}>{campaignResumable.name}</span>
          <span style={{ flexShrink: 0 }}>: resumable</span>
        </span>
      )}

      {/* PRD 14 — Quantum AI Lab work in flight (discovery run, trainability job). */}
      <LabStatusChips />

      <div style={{ flex: 1 }} />

      {editorFocused && (
        <span style={{ color: colors.textDim, whiteSpace: 'nowrap' }} aria-live="off">
          {compactTabFocusHint(tabMovesFocus)}
        </span>
      )}

      {/* Right side. One truthful item for kernel + run state (driven by the
          kernel first); a failed kernel makes it the Retry action. */}
      {kernelModel.tone === 'error' ? (
        // The banner under the editor tabs owns Retry; this item takes you to it (and retries only when no banner is showing).
        <Tooltip label={kernelModel.detail} placement="above">
          <button
            type="button"
            onClick={() => { if (!focusKernelBanner()) retryKernel(); }}
            aria-label={`${kernelModel.label}. Show details and retry`}
            className="statusbar-ctl"
            style={{ ...chipStyle, color: toneColor.error, cursor: 'pointer', border: 'none' }}
          >
            <KernelDot color={toneColor.error} pulse={false} />
            {kernelModel.label}
          </button>
        </Tooltip>
      ) : (
        <Tooltip label={kernelModel.detail} placement="above">
          <span style={{ ...chipStyle, color: kernelModel.tone === 'idle' ? colors.textMuted : colors.text }} aria-live="polite">
            <KernelDot color={toneColor[kernelModel.tone]} pulse={kernelModel.tone === 'busy' || kernelModel.tone === 'running'} />
            {kernelModel.label}
          </span>
        </Tooltip>
      )}
      {/* The workspace-mode toggle moved to the far-left ModeChip (Phase B).
          UI mode only exists in Learn: Research ignores uiModeStore entirely. */}
      <Tooltip label="Command palette" shortcut={shortcutLabel('palette')} placement="above">
        <button
          onClick={() => openPalette(true)}
          aria-label="Open command palette"
          className="statusbar-ctl"
          style={{ ...chipStyle, border: 'none', cursor: 'pointer', gap: 5 }}
        >
          {/* The Command glyph is the Mac key; elsewhere the button is a terminal-style prompt. */}
          {isMacPlatform() ? <Command size={12} /> : <SquareTerminal size={12} />}
          <span>Commands</span>
        </button>
      </Tooltip>
      {workspaceMode === 'learn' && <UiLevelMenu />}
      <Tooltip label={`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} theme`} shortcut={shortcutLabel('toggle-theme')}>
        <button
          onClick={themeToggle}
          aria-label={`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} theme`}
          className="statusbar-ctl"
          style={{
            border: 'none', cursor: 'pointer',
            width: 22, height: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {themeMode === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </Tooltip>
    </div>
  );
}
