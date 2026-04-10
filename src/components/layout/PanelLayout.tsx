import { useState, useRef, useEffect, useCallback } from 'react';
import { usePlatform } from '../../platform/PlatformProvider';
import { ErrorBoundary } from '../ErrorBoundary';
import { QuantumEditor } from '../editor/QuantumEditor';
import { EditorTabs } from '../editor/EditorTabs';
import { Breadcrumbs } from '../editor/Breadcrumbs';
import { CircuitRenderer } from '../circuit/CircuitRenderer';
import { ProbabilityHistogram } from '../histogram/ProbabilityHistogram';
import { BlochPanel } from '../bloch/BlochSphere';
import { DiracSidePanel } from '../dirac/DiracSidePanel';
import { ActivityBar } from './ActivityBar';
import type { ActivityView } from './ActivityBar';
import { Sidebar } from './Sidebar';
import { useEditorStore } from '../../stores/editorStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useThemeStore } from '../../stores/themeStore';
import { useExerciseStore } from '../../stores/exerciseStore';
import { useUIModeStore } from '../../stores/uiModeStore';
import { useLearnStore } from '../../stores/learnStore';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { LearnModeView } from '../learning/LearnModeView';
import { ChallengeModeView } from '../challenges/ChallengeModeView';
import { ChevronDown, ChevronUp, Play, Sun, Moon, X, Circle } from 'lucide-react';
import type { Framework } from '../../types/quantum';

const DEFAULT_BOTTOM_HEIGHT = 200;
const DEFAULT_SIDEBAR_WIDTH = 240;

const STARTER_TEMPLATES: Record<Framework, string> = {
  qiskit: `from qiskit import QuantumCircuit\n\n# Create a Bell State\nqc = QuantumCircuit(2, 2)\nqc.h(0)\nqc.cx(0, 1)\nqc.measure([0, 1], [0, 1])\n`,
  cirq: `import cirq\n\n# Create a Bell State\nq0, q1 = cirq.LineQubit.range(2)\ncircuit = cirq.Circuit([\n    cirq.H(q0),\n    cirq.CNOT(q0, q1),\n    cirq.measure(q0, q1, key='result'),\n])\n`,
  'cuda-q': `import cudaq\n\n# Create a Bell State\n@cudaq.kernel\ndef bell():\n    q = cudaq.qvector(2)\n    h(q[0])\n    cx(q[0], q[1])\n    mz(q)\n`,
};

/* ── Framework Selector ── */
function FrameworkSelector() {
  const [open, setOpen] = useState(false);
  const framework = useEditorStore((s) => s.framework);
  const setFramework = useEditorStore((s) => s.setFramework);
  const setCode = useEditorStore((s) => s.setCode);
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const frameworks: Framework[] = ['qiskit', 'cirq', 'cuda-q'];
  const dn = (f: Framework) => f === 'cuda-q' ? 'CUDA-Q' : f.charAt(0).toUpperCase() + f.slice(1);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} style={{
        background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 4,
        color: colors.accentLight, cursor: 'pointer', fontSize: 11,
        fontFamily: "'Geist Sans', sans-serif",
        padding: '1px 8px', display: 'flex', alignItems: 'center', gap: 4, height: 18,
      }}
        onMouseEnter={(e) => { e.currentTarget.style.background = colors.bgElevated; e.currentTarget.style.borderColor = colors.borderStrong; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = colors.border; }}
      >{dn(framework)} <ChevronDown size={9} /></button>
      {open && (
        <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6,
          background: colors.bgElevated, border: `1px solid ${colors.borderStrong}`,
          borderRadius: 6, overflow: 'hidden', zIndex: 1000, minWidth: 160, boxShadow: shadow.md,
        }}>
          {/* Framework switcher */}
          <div style={{ padding: '4px 0' }}>
            <div style={{ padding: '4px 12px 2px', fontSize: 9, fontWeight: 600, color: colors.textDim,
              fontFamily: "'Geist Sans', sans-serif", textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Framework
            </div>
            {frameworks.map((f) => (
              <button key={f} onClick={() => { setFramework(f); setOpen(false); }} style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 12px',
                background: f === framework ? `${colors.accent}12` : 'transparent',
                color: f === framework ? colors.accent : colors.text, border: 'none', cursor: 'pointer',
                fontSize: 12, fontFamily: "'Geist Sans', sans-serif", textAlign: 'left',
              }}
                onMouseEnter={(e) => { if (f !== framework) e.currentTarget.style.background = `${colors.accent}08`; }}
                onMouseLeave={(e) => { if (f !== framework) e.currentTarget.style.background = 'transparent'; }}
              >
                {f === framework && <span style={{ color: colors.accent, fontSize: 10 }}>●</span>}
                <span style={{ marginLeft: f === framework ? 0 : 18 }}>{dn(f)}</span>
              </button>
            ))}
          </div>
          {/* New file from template */}
          <div style={{ borderTop: `1px solid ${colors.border}`, padding: '4px 0' }}>
            <div style={{ padding: '4px 12px 2px', fontSize: 9, fontWeight: 600, color: colors.textDim,
              fontFamily: "'Geist Sans', sans-serif", textTransform: 'uppercase', letterSpacing: 0.5 }}>
              New from template
            </div>
            {frameworks.map((f) => (
              <button key={`tpl-${f}`} onClick={() => { setCode(STARTER_TEMPLATES[f]); setFramework(f); setOpen(false); }}
                style={{ display: 'block', width: '100%', padding: '5px 12px', background: 'transparent',
                  color: colors.textMuted, border: 'none', cursor: 'pointer', fontSize: 12,
                  fontFamily: "'Geist Sans', sans-serif", textAlign: 'left' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = colors.text; e.currentTarget.style.background = `${colors.accent}08`; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = colors.textMuted; e.currentTarget.style.background = 'transparent'; }}
              >New {dn(f)} file</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const uiMode = useUIModeStore((s) => s.mode);
  const cycleMode = useUIModeStore((s) => s.cycleMode);
  const themeMode = useThemeStore((s) => s.mode);
  const themeToggle = useThemeStore((s) => s.toggle);
  const platform = usePlatform();
  const exercise = useExerciseStore((s) => s.activeExercise);
  const endExercise = useExerciseStore((s) => s.endExercise);
  const modeColors = { beginner: colors.success, intermediate: colors.warning, advanced: colors.error };

  const statusText = isRunning ? 'Running...' : result ? `Done (${result.execution_time_ms}ms)` : 'Ready';

  const handleRun = () => { import('../../App').then(({ getExecute }) => { const e = getExecute(); if (e) e(); }); };
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
      <FrameworkSelector />
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
      <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: colors.textDim, fontSize: 10 }}>
        <Circle size={5} fill={connected ? colors.success : colors.error} stroke="none" />
        Kernel
      </span>
      <span style={{ color: isRunning ? colors.accent : colors.textDim, fontSize: 10,
        ...(isRunning ? { animation: 'nuclei-heartbeat 1.5s ease infinite' } : {}) }}>
        {statusText}
      </span>
      <button onClick={handleRun} disabled={isRunning} title="Run (⌘+Enter)" style={{
        padding: '0 8px', height: 16, background: isRunning ? colors.bgElevated : colors.accent,
        color: '#fff', border: 'none', borderRadius: 3, cursor: isRunning ? 'default' : 'pointer',
        fontSize: 10, fontFamily: "'Geist Sans', sans-serif", fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 3, boxShadow: isRunning ? 'none' : shadow.sm,
      }}
        onMouseEnter={(e) => { if (!isRunning) e.currentTarget.style.boxShadow = '0 0 10px rgba(0,180,216,0.3)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.boxShadow = isRunning ? 'none' : shadow.sm; }}>
        {isRunning ? 'Running...' : <><Play size={9} fill="currentColor" /> Run</>}
      </button>
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
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [isDraggingH, setIsDraggingH] = useState(false);
  const [isDraggingV, setIsDraggingV] = useState(false);

  const colors = useThemeStore((s) => s.colors);
  const uiMode = useUIModeStore((s) => s.mode);
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- expand bottom panel on new result
    if (uiMode === 'beginner' && result) setBottomCollapsed(false);
  }, [result, uiMode]);

  // Load persisted layout
  useEffect(() => {
    (async () => {
      try {
        const bh = await platform.getStoredValue<number>('layout_bottomHeight');
        const sw = await platform.getStoredValue<number>('layout_sidebarWidth');
        if (bh) setBottomHeight(bh);
        if (sw) setSidebarWidth(sw);
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
      } catch { /* non-critical layout persistence */ }
    }, 500);
  }, [bottomHeight, sidebarWidth, platform]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDraggingH) {
      // Horizontal drag controls the split between editor area and viz area
      // This is a percentage of the editor content area (after sidebar)
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
            <ChallengeModeView />
          </div>
        ) : isLearnMode ? (
          /* Learn Mode — full content area + Dirac */
          <div style={{
            flex: 1, minWidth: 0, overflow: 'hidden',
            animation: 'nuclei-fade-in 200ms ease',
          }}>
            <LearnModeView />
          </div>
        ) : (
          <>
            {/* Editor + Viz area */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {/* Top: editor area + visualization */}
              <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Left: Editor with tabs + breadcrumbs */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
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
                  onDoubleClick={() => {}}
                />

                {/* Right: Circuit + Bloch */}
                <div style={{ width: '40%', minWidth: 200, display: 'flex', flexDirection: 'column' }}>
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
