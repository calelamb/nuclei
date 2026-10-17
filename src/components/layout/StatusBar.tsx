import { Circle, Sun, Moon, X, Command } from 'lucide-react';
import { usePlatform } from '../../platform/PlatformProvider';
import { useCircuitStore } from '../../stores/circuitStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';
import { TYPOGRAPHY } from '../../styles/tokens';
import { useUIModeStore } from '../../stores/uiModeStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useExperimentRunStore } from '../../stores/experimentRunStore';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { useExerciseStore } from '../../stores/exerciseStore';
import { useLayoutStore, type LayoutPreset } from '../../stores/layoutStore';
import { ModeChip } from './ModeChip';
import { Tooltip } from '../ui';
import { shortcutLabel } from '../../config/keybindings';
import { useEditorFocusStore } from '../../stores/editorFocusStore';
import { tabFocusHint } from '../../lib/tabFocusHint';
import { useHelpOverlayStore } from '../../stores/helpOverlayStore';
import { useUiFeatures } from '../../hooks/useUiFeatures';
import { getKernelStatusModel, type KernelTone } from './kernelStatusModel';
import { retryKernel } from '../../lib/kernelControl';

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

/* ── Layout Preset Switcher ── */
function LayoutPresetSwitcher() {
  const preset = useLayoutStore((s) => s.preset);
  const setPreset = useLayoutStore((s) => s.setPreset);
  const colors = useThemeStore((s) => s.colors);
  const platform = usePlatform();

  const options: LayoutPreset[] = ['clean', 'balanced', 'full'];
  const onChange = async (next: LayoutPreset) => {
    setPreset(next);
    try { await platform.setStoredValue('layout_preset', next); } catch { /* non-critical persistence */ }
  };

  return (
    <Tooltip label="Layout preset" placement="above">
    <select
      value={preset}
      onChange={(e) => onChange(e.target.value as LayoutPreset)}
      aria-label="Layout preset"
      style={{
        background: 'transparent',
        color: colors.textMuted,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        height: 20,
        padding: '0 6px',
        fontSize: 11,
        fontFamily: TYPOGRAPHY.fontSans,
        cursor: 'pointer',
      }}
    >
      {options.map((o) => (
        <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>
      ))}
    </select>
    </Tooltip>
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

/* ── Status Bar ── */
export function StatusBar() {
  const snapshot = useCircuitStore((s) => s.snapshot);
  const isRunning = useSimulationStore((s) => s.isRunning);
  const result = useSimulationStore((s) => s.result);
  const lastRunFailed = useSimulationStore((s) => s.lastRunFailed);
  const kernelReady = useEditorStore((s) => s.kernelReady);
  const kernelStatus = useEditorStore((s) => s.kernelStatus);
  const kernelError = useEditorStore((s) => s.kernelError);
  const kernelProgress = useEditorStore((s) => s.kernelProgress);
  const colors = useThemeStore((s) => s.colors);
  const uiMode = useUIModeStore((s) => s.mode);
  const cycleMode = useUIModeStore((s) => s.cycleMode);
  const features = useUiFeatures();
  const editorFocused = useEditorFocusStore((s) => s.focused);
  const tabMovesFocus = useEditorFocusStore((s) => s.tabMovesFocus);
  const openPalette = useHelpOverlayStore((s) => s.setPaletteOpen);
  const themeMode = useThemeStore((s) => s.mode);
  const themeToggle = useThemeStore((s) => s.toggle);
  const workspaceMode = useWorkspaceStore((s) => s.mode);
  const activeRun = useExperimentRunStore((s) => s.active);
  const campaignRunning = useQecCampaignStore((s) => s.running);
  const campaignProgress = useQecCampaignStore((s) => s.progress);
  const campaignName = useQecCampaignStore((s) => s.campaignName);
  const campaignResumable = useQecCampaignStore((s) => s.resumable);
  const platform = usePlatform();
  const exercise = useExerciseStore((s) => s.activeExercise);
  const endExercise = useExerciseStore((s) => s.endExercise);
  const kernelModel = getKernelStatusModel({
    kernelStatus,
    kernelReady,
    kernelError,
    kernelProgress,
    isRunning,
    lastRunFailed,
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
    }} role="toolbar" aria-label="Status bar">
      {/* Mode chip — far-left mode identity + switcher (PRD 11 Phase B). */}
      <ModeChip />

      {/* Left side */}
      <span style={{ color: colors.textMuted }}>
        Qubits: {snapshot ? snapshot.qubit_count : '—'}
      </span>
      <span style={{ color: colors.textMuted }}>
        Depth: {snapshot ? snapshot.depth : '—'}
      </span>
      {features.layoutPresets && <LayoutPresetSwitcher />}

      {exercise && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: colors.dirac, fontSize: 11, minWidth: 0 }}>
          <span style={truncName}>{exercise.title}</span>
          <button onClick={endExercise} aria-label="End exercise" title="End exercise" style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', padding: 0, width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = colors.error; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = colors.textMuted; }}>
            <X size={11} />
          </button>
        </span>
      )}

      {/* PRD 09 Phase D — compact sweep indicator, Research mode only. */}
      {workspaceMode === 'research' && activeRun && (
        <span
          title={`${activeRun.experimentName}: ${activeRun.progress.completed}/${activeRun.progress.total} runs`}
          style={{ display: 'flex', alignItems: 'center', gap: 4, color: colors.accent, fontSize: 11, minWidth: 0 }}
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
          style={{ display: 'flex', alignItems: 'center', gap: 4, color: colors.dirac, fontSize: 11, minWidth: 0 }}
        >
          <Circle size={5} fill={colors.dirac} stroke="none" style={{ animation: 'nuclei-heartbeat 1.5s ease infinite', flexShrink: 0 }} />
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

      <div style={{ flex: 1 }} />

      {editorFocused && (
        <span style={{ color: colors.textDim, whiteSpace: 'nowrap' }} aria-live="off">
          {tabFocusHint(tabMovesFocus)}
        </span>
      )}

      {/* Right side. One truthful item for kernel + run state (driven by the
          kernel first); a failed kernel makes it the Retry action. */}
      {kernelModel.tone === 'error' ? (
        <button
          type="button"
          onClick={retryKernel}
          title={kernelModel.detail}
          aria-label={`${kernelModel.label}. Click to retry`}
          style={{ ...chipStyle, color: toneColor.error, cursor: 'pointer', background: 'transparent', border: 'none' }}
        >
          <KernelDot color={toneColor.error} pulse={false} />
          {kernelModel.label}
        </button>
      ) : (
        <span style={{ ...chipStyle, color: kernelModel.tone === 'idle' ? colors.textMuted : colors.text }} title={kernelModel.detail} aria-live="polite">
          <KernelDot color={toneColor[kernelModel.tone]} pulse={kernelModel.tone === 'busy' || kernelModel.tone === 'running'} />
          {kernelModel.label}
        </span>
      )}
      {/* The workspace-mode toggle moved to the far-left ModeChip (Phase B).
          UI mode only exists in Learn: Research ignores uiModeStore entirely. */}
      <Tooltip label="Command palette" shortcut={shortcutLabel('palette')} placement="above">
        <button
          onClick={() => openPalette(true)}
          aria-label="Open command palette"
          className="nuclei-quiet"
          style={{ ...chipStyle, background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer', gap: 5 }}
        >
          <Command size={12} />
          <span>Commands</span>
        </button>
      </Tooltip>
      {workspaceMode === 'learn' && (
        <Tooltip label="Cycle UI mode" shortcut={shortcutLabel('cycle-ui-mode')}>
          <button
            onClick={cycleMode}
            aria-label={`UI mode: ${uiMode}. Click to change`}
            className="nuclei-quiet"
            style={{
              padding: '0 8px', height: 20, background: 'transparent', border: 'none', borderRadius: 4,
              cursor: 'pointer', fontSize: 11, fontFamily: TYPOGRAPHY.fontSans,
              fontWeight: 500, textTransform: 'capitalize',
            }}
          >
            {uiMode}
          </button>
        </Tooltip>
      )}
      <Tooltip label={`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} theme`} shortcut={shortcutLabel('toggle-theme')}>
        <button
          onClick={themeToggle}
          aria-label={`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} theme`}
          className="nuclei-quiet"
          style={{
            background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
            width: 22, height: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {themeMode === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </button>
      </Tooltip>
    </div>
  );
}
