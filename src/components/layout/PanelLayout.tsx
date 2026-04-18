import { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react';
import { usePlatform } from '../../platform/PlatformProvider';
import { ErrorBoundary } from '../ErrorBoundary';
import { QuantumEditor } from '../editor/QuantumEditor';
import { EditorTabs } from '../editor/EditorTabs';
import { Breadcrumbs } from '../editor/Breadcrumbs';
import { CircuitRenderer } from '../circuit/CircuitRenderer';
import { ProbabilityHistogram } from '../histogram/ProbabilityHistogram';
import { BlochPanel } from '../bloch/BlochPanel';
import { DiracSidePanel } from '../dirac/DiracSidePanel';
import { ActivityBar } from './ActivityBar';
import type { ActivityView } from './ActivityBar';
import { Sidebar } from './Sidebar';
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

/* ── Terminal Panel ── */
function TerminalPanel() {
  const { terminalOutput } = useSimulationStore();
  const colors = useThemeStore((s) => s.colors);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [terminalOutput]);
  return (
    <div ref={scrollRef} style={{ height: '100%', overflow: 'auto', fontFamily: "'Geist Mono', 'JetBrains Mono', monospace", fontSize: 12, color: colors.text, padding: '8px 12px' }}>
      {terminalOutput.length === 0 ? (
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

/* ── Bottom Panel ── */
function BottomPanel({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const [activeTab, setActiveTab] = useState<'terminal' | 'histogram'>('terminal');
  const result = useSimulationStore((s) => s.result);
  const colors = useThemeStore((s) => s.colors);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- switches tab on new result
  useEffect(() => { if (result) setActiveTab('histogram'); }, [result]);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Panel header */}
      <div style={{ height: 28, display: 'flex', alignItems: 'center', borderBottom: collapsed ? 'none' : `1px solid ${colors.border}`, backgroundColor: colors.bg, flexShrink: 0 }}>
        {(['terminal', 'histogram'] as const).map((tab) => (
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
      {!collapsed && <div style={{ flex: 1, overflow: 'hidden' }}>{activeTab === 'terminal' ? <TerminalPanel /> : <ProbabilityHistogram />}</div>}
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
  const platform = usePlatform();
  const isLearnMode = useLearnStore((s) => s.isLearnMode);
  const enterLearnMode = useLearnStore((s) => s.enterLearnMode);
  const exitLearnMode = useLearnStore((s) => s.exitLearnMode);
  const isChallengeMode = useChallengeModeStore((s) => s.isChallengeMode);
  const enterChallengeMode = useChallengeModeStore((s) => s.enterChallengeMode);
  const exitChallengeMode = useChallengeModeStore((s) => s.exitChallengeMode);

  const showBloch = uiMode !== 'beginner';
  const showBottomPanel = uiMode !== 'beginner';
  const showSidebar = !isLearnMode && !isChallengeMode && activeView !== null;
  const topSplitRef = useRef<HTMLDivElement>(null);

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
        if (bh) setBottomHeight(bh);
        if (sw) setSidebarWidth(sw);
        if (epw) setEditorPaneWidth(epw);
      } catch { /* non-critical layout persistence */ }
    })();
  }, [platform]);

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
                {/* Left: Editor with tabs + breadcrumbs */}
                <div style={{ width: `${editorPaneWidth}%`, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <EditorTabs />
                  <Breadcrumbs />
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

                {/* Right: Circuit + Bloch */}
                <div style={{ width: `${100 - editorPaneWidth}%`, minWidth: 200, display: 'flex', flexDirection: 'column' }}>
                  <div style={{
                    flex: showBloch ? 6 : 1,
                    borderBottom: showBloch ? `1px solid ${colors.border}` : 'none',
                    overflow: 'hidden', position: 'relative',
                  }}>
                    <CircuitRenderer />
                  </div>
                  {showBloch && (
                    <div style={{ flex: 4, overflow: 'hidden', position: 'relative' }}>
                      <BlochPanel />
                    </div>
                  )}
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
                    <BottomPanel collapsed={bottomCollapsed} onToggle={() => setBottomCollapsed((c) => !c)} />
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
