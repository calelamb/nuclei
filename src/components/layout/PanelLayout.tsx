import { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react';
import { usePlatform } from '../../platform/PlatformProvider';
import { ErrorBoundary } from '../ErrorBoundary';
import { QuantumEditor } from '../editor/QuantumEditor';
import { EditorTabs } from '../editor/EditorTabs';
import { Breadcrumbs } from '../editor/Breadcrumbs';
import { ProbabilityHistogram } from '../histogram/ProbabilityHistogram';
import { BlochPanel } from '../bloch/BlochPanel';
import { DiracSidePanel } from '../dirac/DiracSidePanel';
import { ActivityBar } from './ActivityBar';
import type { ActivityView } from './ActivityBar';
import { Sidebar } from './Sidebar';
import { PanelReveal } from './PanelReveal';
import { HistogramChip } from '../histogram/HistogramChip';
import { LaunchStrip } from '../hardware/LaunchStrip';
import { useHardwareStore } from '../../stores/hardwareStore';
import { useLayoutStore, computeVisiblePanels, type LayoutPreset } from '../../stores/layoutStore';
import { useDiracStore } from '../../stores/diracStore';
import { DEFAULT_EDITOR_PANE_WIDTH, computeEditorPaneWidth } from './layoutMath';
import { useEditorStore } from '../../stores/editorStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useThemeStore } from '../../stores/themeStore';
import { useExerciseStore } from '../../stores/exerciseStore';
import { useUIModeStore } from '../../stores/uiModeStore';
import { useLearnStore } from '../../stores/learnStore';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { ChevronDown, ChevronUp, Sun, Moon, X, Circle } from 'lucide-react';

const LearnModeView = lazy(async () => ({
  default: (await import('../learning/LearnModeView')).LearnModeView,
}));
const ChallengeModeView = lazy(async () => ({
  default: (await import('../challenges/ChallengeModeView')).ChallengeModeView,
}));

const DEFAULT_BOTTOM_HEIGHT = 200;
const DEFAULT_SIDEBAR_WIDTH = 240;

/* ── Hardware-aware histogram chip ──
 * Wraps HistogramChip to pipe in the most recent completed hardware-job
 * probabilities alongside the classical-simulator run. When a hardware job
 * has completed, the chip shows dual bars per outcome (sim vs hw).
 */
function HardwareAwareHistogramChip({
  simProbabilities,
  onDismiss,
}: {
  simProbabilities: Record<string, number> | null;
  onDismiss: () => void;
}) {
  const jobs = useHardwareStore((s) => s.jobs);
  const results = useHardwareStore((s) => s.results);
  const completed = jobs.find((j) => j.status === 'complete');
  const hwProbabilities = completed ? results[completed.id]?.probabilities ?? null : null;
  const hwLabel = completed ? `${completed.backend} (${completed.shots} shots)` : undefined;
  return (
    <HistogramChip
      probabilities={simProbabilities}
      hwProbabilities={hwProbabilities}
      hwLabel={hwLabel}
      onDismiss={onDismiss}
    />
  );
}

/* ── Terminal Panel ── */
function TerminalPanel() {
  const { terminalOutput } = useSimulationStore();
  const colors = useThemeStore((s) => s.colors);
  const rewritten = useDiracStore((s) => s.rewrittenError);
  const clearRewrittenError = useDiracStore((s) => s.clearRewrittenError);
  const setCode = useEditorStore((s) => s.setCode);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [terminalOutput, rewritten]);
  return (
    <div ref={scrollRef} style={{ height: '100%', overflow: 'auto', fontFamily: "'Geist Mono', 'JetBrains Mono', monospace", fontSize: 12, color: colors.text, padding: '8px 12px' }}>
      {rewritten && (
        <div
          role="alert"
          style={{
            marginBottom: 10,
            padding: '10px 12px',
            border: `1px solid ${colors.dirac}40`,
            borderRadius: 10,
            background: `${colors.dirac}12`,
            fontFamily: "'Geist Sans', sans-serif",
            fontSize: 12,
            lineHeight: 1.5,
            color: colors.text,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: colors.dirac, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>
            Dirac
          </div>
          <div style={{ marginBottom: rewritten.fix ? 10 : 0 }}>{rewritten.explanation}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {rewritten.fix && (
              <button
                onClick={() => { setCode(rewritten.fix!); clearRewrittenError(); }}
                style={{
                  background: colors.dirac, color: '#fff', border: 'none',
                  borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600,
                  cursor: 'pointer', fontFamily: "'Geist Sans', sans-serif",
                }}
              >Apply fix</button>
            )}
            <button
              onClick={clearRewrittenError}
              style={{
                background: 'transparent', color: colors.textDim,
                border: `1px solid ${colors.border}`,
                borderRadius: 6, padding: '4px 10px', fontSize: 11,
                cursor: 'pointer', fontFamily: "'Geist Sans', sans-serif",
              }}
            >Dismiss</button>
          </div>
        </div>
      )}
      {terminalOutput.length === 0 && !rewritten ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.textDim }}>
          <span style={{ color: colors.accent, opacity: 0.3, fontFamily: "'Geist Mono', monospace" }}>{'>'}_</span>
          <span style={{ fontSize: 11 }}>Terminal output will appear here</span>
        </div>
      ) : terminalOutput.map((line, i) => (
        <div key={i} style={{ color: line.startsWith('Error') ? colors.error : colors.text, lineHeight: 1.5 }}>{line}</div>
      ))}
    </div>
  );
}

/* ── Bottom Panel ──
 * In the new progressive-reveal layout the histogram no longer lives here;
 * it's rendered as a compact chip beneath the Bloch sphere. The bottom
 * panel shows Terminal by default, and the full histogram only when the
 * user has opted into the `full` layout preset.
 */
function BottomPanel({
  collapsed,
  onToggle,
  showFullHistogram,
}: {
  collapsed: boolean;
  onToggle: () => void;
  showFullHistogram: boolean;
}) {
  const [activeTab, setActiveTab] = useState<'terminal' | 'histogram'>('terminal');
  const result = useSimulationStore((s) => s.result);
  const colors = useThemeStore((s) => s.colors);
  // Auto-focus histogram tab on a new result, but only if the full histogram
  // is actually available (otherwise the tab would be a dead link).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- switches tab on new result
  useEffect(() => {
    if (result && showFullHistogram) setActiveTab('histogram');
  }, [result, showFullHistogram]);

  const tabs: Array<'terminal' | 'histogram'> = showFullHistogram
    ? ['terminal', 'histogram']
    : ['terminal'];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Panel header */}
      <div style={{ height: 28, display: 'flex', alignItems: 'center', borderBottom: collapsed ? 'none' : `1px solid ${colors.border}`, backgroundColor: colors.bg, flexShrink: 0 }}>
        {tabs.map((tab) => (
          <button key={tab} onClick={() => { if (collapsed) onToggle(); setActiveTab(tab); }} style={{
            padding: '0 14px', height: '100%',
            background: 'transparent',
            color: !collapsed && activeTab === tab ? colors.text : colors.textDim,
            border: 'none',
            borderBottom: !collapsed && activeTab === tab ? `1px solid ${colors.accent}` : '1px solid transparent',
            cursor: 'pointer', fontSize: 10, fontWeight: 500,
            fontFamily: "'Geist Sans', sans-serif", textTransform: 'uppercase', letterSpacing: 0.5,
          }} role="tab" aria-selected={!collapsed && activeTab === tab}>{tab}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={onToggle} style={{ background: 'transparent', border: 'none', color: colors.textDim, cursor: 'pointer', padding: '0 10px', display: 'flex', alignItems: 'center' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}
          aria-label={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>
      {!collapsed && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {activeTab === 'terminal' || !showFullHistogram
            ? <TerminalPanel />
            : <ProbabilityHistogram />}
        </div>
      )}
    </div>
  );
}

/* ── Resize Handle ── */
function ResizeHandle({ direction, isDragging, onMouseDown, onDoubleClick }: {
  direction: 'horizontal' | 'vertical'; isDragging: boolean; onMouseDown: () => void; onDoubleClick: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const isH = direction === 'horizontal';
  return (
    <div style={{ [isH ? 'width' : 'height']: isDragging ? 2 : 1, cursor: isH ? 'col-resize' : 'row-resize',
      backgroundColor: isDragging ? colors.accent : colors.border, flexShrink: 0, position: 'relative',
      transition: isDragging ? 'none' : 'all 150ms ease' }}
      onMouseDown={onMouseDown} onDoubleClick={onDoubleClick} role="separator">
      <div style={{ position: 'absolute', [isH ? 'left' : 'top']: -3, [isH ? 'right' : 'bottom']: -3,
        [isH ? 'width' : 'height']: 8, [isH ? 'top' : 'left']: 0, [isH ? 'bottom' : 'right']: 0, zIndex: 2 }}
        onMouseEnter={(e) => { const p = e.currentTarget.parentElement; if (p && !isDragging) { p.style.backgroundColor = colors.accent; p.style[isH ? 'width' : 'height'] = '2px'; } }}
        onMouseLeave={(e) => { const p = e.currentTarget.parentElement; if (p && !isDragging) { p.style.backgroundColor = colors.border; p.style[isH ? 'width' : 'height'] = '1px'; } }}
      />
    </div>
  );
}

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
function StatusBar() {
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

/* ── Main Layout ── */
export function PanelLayout() {
  const [activeView, setActiveView] = useState<ActivityView | null>('files');
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [bottomHeight, setBottomHeight] = useState(DEFAULT_BOTTOM_HEIGHT);
  const [editorPaneWidth, setEditorPaneWidth] = useState(DEFAULT_EDITOR_PANE_WIDTH);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [isDraggingH, setIsDraggingH] = useState(false);
  const [isDraggingV, setIsDraggingV] = useState(false);

  const colors = useThemeStore((s) => s.colors);
  const uiMode = useUIModeStore((s) => s.mode);
  const experimentalFeatures = useSettingsStore((s) => s.general.experimentalFeatures);
  const result = useSimulationStore((s) => s.result);
  const terminalOutput = useSimulationStore((s) => s.terminalOutput);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const platform = usePlatform();
  const isLearnMode = useLearnStore((s) => s.isLearnMode);
  const enterLearnMode = useLearnStore((s) => s.enterLearnMode);
  const exitLearnMode = useLearnStore((s) => s.exitLearnMode);
  const isChallengeMode = useChallengeModeStore((s) => s.isChallengeMode);
  const enterChallengeMode = useChallengeModeStore((s) => s.enterChallengeMode);
  const exitChallengeMode = useChallengeModeStore((s) => s.exitChallengeMode);

  const preset = useLayoutStore((s) => s.preset);
  const setPreset = useLayoutStore((s) => s.setPreset);
  const chipDismissed = useLayoutStore((s) => s.histogramChipDismissed);
  const dismissChip = useLayoutStore((s) => s.dismissHistogramChip);
  const resetRunArtifacts = useLayoutStore((s) => s.resetRunArtifacts);

  const visible = computeVisiblePanels({
    preset,
    snapshot,
    result,
    hasTerminalOutput: terminalOutput.length > 0,
    errorActive: false,
  });

  const showBottomPanel = visible.terminal || visible.histogramFull;
  const showSidebar = !isLearnMode && !isChallengeMode && activeView !== null;
  const topSplitRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fresh run should re-show a previously-dismissed histogram chip.
    if (result) resetRunArtifacts();
  }, [result, resetRunArtifacts]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- expand bottom panel on new result
    if (uiMode === 'beginner' && result) setBottomCollapsed(false);
  }, [result, uiMode]);

  useEffect(() => {
    if (experimentalFeatures) return;

    if (activeView && ['search', 'circuit', 'plugins', 'hardware', 'community'].includes(activeView)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- redirect away from experimental views when the flag flips off
      setActiveView('files');
    }
  }, [activeView, experimentalFeatures]);

  // Load persisted layout
  useEffect(() => {
    (async () => {
      try {
        const bh = await platform.getStoredValue<number>('layout_bottomHeight');
        const sw = await platform.getStoredValue<number>('layout_sidebarWidth');
        const epw = await platform.getStoredValue<number>('layout_editorPaneWidth');
        const lp = await platform.getStoredValue<LayoutPreset>('layout_preset');
        if (bh) setBottomHeight(bh);
        if (sw) setSidebarWidth(sw);
        if (epw) setEditorPaneWidth(epw);
        if (lp === 'clean' || lp === 'balanced' || lp === 'full') setPreset(lp);
      } catch { /* non-critical layout persistence */ }
    })();
  }, [platform, setPreset]);

  // Listen for cross-component navigation to Settings
  const settingsSignal = useNavigationStore((s) => s.settingsSignal);
  useEffect(() => {
    if (settingsSignal > 0) {
      if (isLearnMode) exitLearnMode();
      if (isChallengeMode) exitChallengeMode();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- navigates in response to cross-component signal
      setActiveView('settings');
    }
  }, [settingsSignal, isLearnMode, isChallengeMode, exitLearnMode, exitChallengeMode]);

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(async () => {
      try {
        await platform.setStoredValue('layout_bottomHeight', bottomHeight);
        await platform.setStoredValue('layout_sidebarWidth', sidebarWidth);
        await platform.setStoredValue('layout_editorPaneWidth', editorPaneWidth);
      } catch { /* non-critical layout persistence */ }
    }, 500);
  }, [bottomHeight, editorPaneWidth, sidebarWidth, platform]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDraggingH) {
      const rect = topSplitRef.current?.getBoundingClientRect();
      if (rect) {
        setEditorPaneWidth(computeEditorPaneWidth(e.clientX, rect));
      }
    }
    if (isDraggingV) {
      const fromBottom = window.innerHeight - e.clientY - 22; // account for status bar
      setBottomHeight(Math.max(80, Math.min(500, fromBottom)));
    }
  };

  const handleMouseUp = () => { setIsDraggingH(false); setIsDraggingV(false); };

  const handleActivitySelect = (view: ActivityView) => {
    if (view === 'learning') {
      if (isLearnMode) {
        exitLearnMode();
      } else {
        enterLearnMode();
        if (isChallengeMode) exitChallengeMode();
        setActiveView(null);
      }
      return;
    }
    if (view === 'challenges') {
      if (isChallengeMode) {
        exitChallengeMode();
      } else {
        enterChallengeMode();
        if (isLearnMode) exitLearnMode();
        setActiveView(null);
      }
      return;
    }
    // If in learn mode or challenge mode and clicking another view, exit first
    if (isLearnMode) exitLearnMode();
    if (isChallengeMode) exitChallengeMode();
    setActiveView((prev) => prev === view ? null : view);
  };

  const effectiveBottomHeight = bottomCollapsed ? 28 : bottomHeight;

  return (
    <div
      style={{
        width: '100vw', height: '100vh',
        display: 'flex', flexDirection: 'column',
        backgroundColor: colors.bg,
        overflow: 'hidden',
        userSelect: isDraggingH || isDraggingV ? 'none' : 'auto',
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Main area (everything except status bar) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Activity Bar */}
        <ActivityBar active={isChallengeMode ? 'challenges' : isLearnMode ? 'learning' : activeView} onSelect={handleActivitySelect} />

        {/* Sidebar (hidden in Learn Mode) */}
        {showSidebar && activeView && (
          <Sidebar view={activeView} width={sidebarWidth} onWidthChange={setSidebarWidth} />
        )}

        {isChallengeMode ? (
          /* Challenge Mode — full content area */
          <div style={{
            flex: 1, minWidth: 0, overflow: 'hidden',
            animation: 'nuclei-fade-in 200ms ease',
          }}>
            <Suspense fallback={null}>
              <ChallengeModeView />
            </Suspense>
          </div>
        ) : isLearnMode ? (
          /* Learn Mode — full content area + Dirac */
          <div style={{
            flex: 1, minWidth: 0, overflow: 'hidden',
            animation: 'nuclei-fade-in 200ms ease',
          }}>
            <Suspense fallback={null}>
              <LearnModeView />
            </Suspense>
          </div>
        ) : (
          <>
            {/* Editor + Viz area */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {/* Top: editor area + visualization */}
              <div ref={topSplitRef} style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Left: Editor with tabs + breadcrumbs + launch strip */}
                <div style={{ width: `${editorPaneWidth}%`, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <EditorTabs />
                  <Breadcrumbs />
                  <LaunchStrip />
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <ErrorBoundary label="Code Editor">
                      <QuantumEditor />
                    </ErrorBoundary>
                  </div>
                </div>

                {/* Resize handle between editor and viz */}
                <ResizeHandle
                  direction="horizontal"
                  isDragging={isDraggingH}
                  onMouseDown={() => setIsDraggingH(true)}
                  onDoubleClick={() => setEditorPaneWidth(DEFAULT_EDITOR_PANE_WIDTH)}
                />

                {/* Right rail: interactive Bloch sphere (full height) +
                    histogram chip. The gate-circuit diagram previously
                    shared this rail but was clipping against the top of
                    the panel and competing for vertical space with the
                    Bloch viz — removed so the sphere gets the full rail
                    and the rail stays uncluttered. */}
                <div style={{ width: `${100 - editorPaneWidth}%`, minWidth: 200, display: 'flex', flexDirection: 'column' }}>
                  <PanelReveal when={visible.bloch} from="right">
                    <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 240 }}>
                      <BlochPanel />
                    </div>
                  </PanelReveal>
                  <PanelReveal when={visible.histogramChip && !chipDismissed} from="bottom">
                    <div style={{ padding: '6px 10px 10px', flexShrink: 0 }}>
                      <HardwareAwareHistogramChip
                        simProbabilities={result?.probabilities ?? null}
                        onDismiss={dismissChip}
                      />
                    </div>
                  </PanelReveal>
                </div>
              </div>

              {/* Bottom panel */}
              {(showBottomPanel || result) && (
                <>
                  {!bottomCollapsed && (
                    <ResizeHandle
                      direction="vertical"
                      isDragging={isDraggingV}
                      onMouseDown={() => setIsDraggingV(true)}
                      onDoubleClick={() => setBottomHeight(DEFAULT_BOTTOM_HEIGHT)}
                    />
                  )}
                  <div style={{ height: effectiveBottomHeight, overflow: 'hidden', flexShrink: 0 }}>
                    <BottomPanel
                      collapsed={bottomCollapsed}
                      onToggle={() => setBottomCollapsed((c) => !c)}
                      showFullHistogram={visible.histogramFull}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Dirac side panel (Code Mode only — Learn Mode has its own) */}
            <DiracSidePanel />
          </>
        )}
      </div>

      {/* Status bar — full width at bottom */}
      <StatusBar />
    </div>
  );
}
