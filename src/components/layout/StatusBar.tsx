import { useCallback } from 'react';
import { Circle, Sun, Moon, X } from 'lucide-react';
import { usePlatform } from '../../platform/PlatformProvider';
import { useCircuitStore } from '../../stores/circuitStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useEditorStore } from '../../stores/editorStore';
import { useThemeStore } from '../../stores/themeStore';
import { useUIModeStore } from '../../stores/uiModeStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useExperimentRunStore } from '../../stores/experimentRunStore';
import { useExerciseStore } from '../../stores/exerciseStore';
import { useLayoutStore, type LayoutPreset } from '../../stores/layoutStore';
import { ModeChip } from './ModeChip';

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
    <select
      value={preset}
      onChange={(e) => onChange(e.target.value as LayoutPreset)}
      aria-label="Layout preset"
      title="Layout preset"
      style={{
        background: 'transparent',
        color: colors.textDim,
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: '1px 6px',
        fontSize: 10,
        fontFamily: "'Geist Sans', sans-serif",
        cursor: 'pointer',
      }}
    >
      {options.map((o) => (
        <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>
      ))}
    </select>
  );
}

/* ── Status Bar ── */
export function StatusBar() {
  const snapshot = useCircuitStore((s) => s.snapshot);
  const isRunning = useSimulationStore((s) => s.isRunning);
  const result = useSimulationStore((s) => s.result);
  const connected = useEditorStore((s) => s.kernelConnected);
  const kernelStatus = useEditorStore((s) => s.kernelStatus);
  const kernelError = useEditorStore((s) => s.kernelError);
  const colors = useThemeStore((s) => s.colors);
  const uiMode = useUIModeStore((s) => s.mode);
  const cycleMode = useUIModeStore((s) => s.cycleMode);
  const themeMode = useThemeStore((s) => s.mode);
  const themeToggle = useThemeStore((s) => s.toggle);
  const workspaceMode = useWorkspaceStore((s) => s.mode);
  const activeRun = useExperimentRunStore((s) => s.active);
  const platform = usePlatform();
  const exercise = useExerciseStore((s) => s.activeExercise);
  const endExercise = useExerciseStore((s) => s.endExercise);
  const modeColors = { beginner: colors.success, intermediate: colors.warning, advanced: colors.error };

  const statusText = isRunning ? 'Running...' : result ? `Done (${result.execution_time_ms}ms)` : 'Ready';

  const handleCycleMode = useCallback(async () => { cycleMode(); try { await platform.setStoredValue('ui_mode', useUIModeStore.getState().mode); } catch { /* non-critical persistence */ } }, [cycleMode, platform]);
  const handleThemeToggle = useCallback(async () => { themeToggle(); try { await platform.setStoredValue('theme', themeMode === 'dark' ? 'light' : 'dark'); } catch { /* non-critical persistence */ } }, [themeToggle, themeMode, platform]);

  return (
    <div style={{
      height: 22, backgroundColor: colors.bgPanel,
      display: 'flex', alignItems: 'center',
      padding: '0 8px', gap: 8,
      fontSize: 11, fontFamily: "'Geist Sans', sans-serif",
      flexShrink: 0, zIndex: 10,
      borderTop: `1px solid ${colors.border}`,
    }} role="toolbar" aria-label="Status bar">
      {/* Mode chip — far-left mode identity + switcher (PRD 11 Phase B). */}
      <ModeChip />

      {/* Left side */}
      <span style={{ color: colors.textDim, fontSize: 10 }}>
        Qubits: {snapshot ? snapshot.qubit_count : '—'}
      </span>
      <span style={{ color: colors.textDim, fontSize: 10 }}>
        Depth: {snapshot ? snapshot.depth : '—'}
      </span>
      <LayoutPresetSwitcher />

      {exercise && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: colors.dirac, fontSize: 10 }}>
          {exercise.title}
          <button onClick={endExercise} style={{ background: 'none', border: 'none', color: colors.textDim, cursor: 'pointer', padding: 0, display: 'flex' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = colors.error; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}>
            <X size={9} />
          </button>
        </span>
      )}

      {/* PRD 09 Phase D — compact sweep indicator, Research mode only. */}
      {workspaceMode === 'research' && activeRun && (
        <span
          title={`${activeRun.experimentName}: ${activeRun.progress.completed}/${activeRun.progress.total} runs`}
          style={{ display: 'flex', alignItems: 'center', gap: 4, color: colors.accent, fontSize: 10 }}
        >
          <Circle size={5} fill={colors.accent} stroke="none" style={{ animation: 'nuclei-heartbeat 1.5s ease infinite' }} />
          {activeRun.experimentName}: {activeRun.progress.completed}/{activeRun.progress.total}
          {activeRun.progress.failures > 0 ? ` (${activeRun.progress.failures} failed)` : ''}
        </span>
      )}

      <div style={{ flex: 1 }} />

      {/* Right side */}
      <span
        style={{ display: 'flex', alignItems: 'center', gap: 3, color: colors.textDim, fontSize: 10 }}
        title={kernelError ?? (
          kernelStatus === 'connecting' ? 'Kernel connecting...'
          : kernelStatus === 'failed' ? 'Kernel not responding'
          : connected ? 'Kernel connected' : 'Kernel disconnected'
        )}
      >
        <Circle
          size={5}
          fill={
            kernelStatus === 'failed' ? colors.error
            : connected ? colors.success
            : kernelStatus === 'connecting' ? colors.warning
            : colors.error
          }
          stroke="none"
        />
        Kernel{kernelStatus === 'failed' ? ' — failed' : kernelStatus === 'connecting' && !connected ? '...' : ''}
      </span>
      <span style={{ color: isRunning ? colors.accent : colors.textDim, fontSize: 10,
        ...(isRunning ? { animation: 'nuclei-heartbeat 1.5s ease infinite' } : {}) }}>
        {statusText}
      </span>
      {/* The workspace-mode toggle moved to the far-left ModeChip (Phase B);
          the redundant right-side text toggle was removed. */}
      <button onClick={handleCycleMode} title="Cycle UI mode (⌘+Shift+L)" style={{
        padding: '0 6px', height: 16, background: 'transparent', border: 'none', borderRadius: 3,
        color: modeColors[uiMode], cursor: 'pointer', fontSize: 10, fontFamily: "'Geist Sans', sans-serif",
        fontWeight: 500, textTransform: 'capitalize',
      }}
        onMouseEnter={(e) => { e.currentTarget.style.background = colors.bgElevated; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
        {uiMode}
      </button>
      <button onClick={handleThemeToggle} title={`${themeMode === 'dark' ? 'Light' : 'Dark'} theme`} style={{
        background: 'transparent', border: 'none', color: colors.textDim, cursor: 'pointer',
        padding: 0, display: 'flex', alignItems: 'center',
      }}
        onMouseEnter={(e) => { e.currentTarget.style.color = colors.text; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}>
        {themeMode === 'dark' ? <Sun size={11} /> : <Moon size={11} />}
      </button>
    </div>
  );
}
