import { useState, useRef, useEffect, useCallback } from 'react';
import { usePlatform } from '../../platform/PlatformProvider';
import { QuantumEditor } from '../editor/QuantumEditor';
import { CircuitRenderer } from '../circuit/CircuitRenderer';
import { ProbabilityHistogram } from '../histogram/ProbabilityHistogram';
import { DiracChat } from '../dirac/DiracChat';
import { BlochPanel } from '../bloch/BlochSphere';
import { useEditorStore } from '../../stores/editorStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useThemeStore } from '../../stores/themeStore';
import { useExerciseStore } from '../../stores/exerciseStore';
import { useLearningStore } from '../../stores/learningStore';
import { LearningPathSidebar } from '../learning/LearningPathSidebar';
import type { Framework } from '../../types/quantum';

const DEFAULT_LEFT_WIDTH = 60;
const DEFAULT_BOTTOM_HEIGHT = 200;

const STARTER_TEMPLATES: Record<Framework, string> = {
  qiskit: `from qiskit import QuantumCircuit

# Create a Bell State
qc = QuantumCircuit(2, 2)
qc.h(0)
qc.cx(0, 1)
qc.measure([0, 1], [0, 1])
`,
  cirq: `import cirq

# Create a Bell State
q0, q1 = cirq.LineQubit.range(2)
circuit = cirq.Circuit([
    cirq.H(q0),
    cirq.CNOT(q0, q1),
    cirq.measure(q0, q1, key='result'),
])
`,
  'cuda-q': `import cudaq

# Create a Bell State
@cudaq.kernel
def bell():
    q = cudaq.qvector(2)
    h(q[0])
    cx(q[0], q[1])
    mz(q)
`,
};

function FrameworkSelector() {
  const [open, setOpen] = useState(false);
  const framework = useEditorStore((s) => s.framework);
  const setFramework = useEditorStore((s) => s.setFramework);
  const setCode = useEditorStore((s) => s.setCode);
  const colors = useThemeStore((s) => s.colors);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const frameworks: Framework[] = ['qiskit', 'cirq', 'cuda-q'];
  const displayName = (f: Framework) => f === 'cuda-q' ? 'CUDA-Q' : f.charAt(0).toUpperCase() + f.slice(1);

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: 'transparent',
          border: `1px solid ${colors.border}`,
          borderRadius: 3,
          color: colors.accentLight,
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: 'Inter, sans-serif',
          padding: '2px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {displayName(framework)}
        <span style={{ fontSize: 8 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          marginTop: 2,
          background: colors.bgPanel,
          border: `1px solid ${colors.border}`,
          borderRadius: 4,
          overflow: 'hidden',
          zIndex: 1000,
          minWidth: 120,
        }}>
          {frameworks.map((f) => (
            <button
              key={f}
              onClick={() => {
                setFramework(f);
                setOpen(false);
              }}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 12px',
                background: f === framework ? colors.border : 'transparent',
                color: f === framework ? colors.accent : colors.text,
                border: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: 'Inter, sans-serif',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => { if (f !== framework) (e.target as HTMLElement).style.background = colors.border; }}
              onMouseLeave={(e) => { if (f !== framework) (e.target as HTMLElement).style.background = 'transparent'; }}
            >
              {displayName(f)}
            </button>
          ))}
          <div style={{ borderTop: `1px solid ${colors.border}`, padding: '4px 0' }}>
            {frameworks.map((f) => (
              <button
                key={`tpl-${f}`}
                onClick={() => {
                  setCode(STARTER_TEMPLATES[f]);
                  setFramework(f);
                  setOpen(false);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '4px 12px',
                  background: 'transparent',
                  color: colors.textMuted,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: 'Inter, sans-serif',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => { (e.target as HTMLElement).style.color = colors.accentLight; }}
                onMouseLeave={(e) => { (e.target as HTMLElement).style.color = colors.textMuted; }}
              >
                New {displayName(f)} file
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TerminalPanel() {
  const { terminalOutput } = useSimulationStore();
  const colors = useThemeStore((s) => s.colors);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  return (
    <div
      ref={scrollRef}
      style={{
        height: '100%',
        overflow: 'auto',
        fontFamily: "'Fira Code', monospace",
        fontSize: 13,
        color: colors.text,
        padding: 12,
      }}
    >
      {terminalOutput.length === 0 ? (
        <span style={{ color: colors.textMuted }}>Terminal output will appear here</span>
      ) : (
        terminalOutput.map((line, i) => (
          <div key={i} style={{ color: line.startsWith('Error') ? colors.error : colors.text }}>
            {line}
          </div>
        ))
      )}
    </div>
  );
}

function BottomPanel({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const [activeTab, setActiveTab] = useState<'terminal' | 'histogram' | 'dirac'>('terminal');
  const result = useSimulationStore((s) => s.result);
  const colors = useThemeStore((s) => s.colors);

  useEffect(() => {
    if (result) {
      setActiveTab('histogram');
    }
  }, [result]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex',
        borderBottom: collapsed ? 'none' : `1px solid ${colors.border}`,
        backgroundColor: colors.bgPanel,
        cursor: 'pointer',
      }}>
        {(['terminal', 'histogram', 'dirac'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              if (collapsed) onToggle();
              setActiveTab(tab);
            }}
            style={{
              padding: '8px 16px',
              background: !collapsed && activeTab === tab ? colors.bg : 'transparent',
              color: !collapsed && activeTab === tab ? colors.accent : colors.textMuted,
              border: 'none',
              borderBottom: !collapsed && activeTab === tab ? `2px solid ${colors.accent}` : '2px solid transparent',
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'Inter, sans-serif',
              textTransform: 'capitalize',
            }}
          >
            {tab === 'dirac' ? 'Dirac AI' : tab}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={onToggle}
          style={{
            background: 'transparent',
            border: 'none',
            color: colors.textMuted,
            cursor: 'pointer',
            fontSize: 12,
            padding: '0 12px',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {collapsed ? '▲' : '▼'}
        </button>
      </div>
      {!collapsed && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {activeTab === 'terminal' && <TerminalPanel />}
          {activeTab === 'histogram' && <ProbabilityHistogram />}
          {activeTab === 'dirac' && <DiracChat />}
        </div>
      )}
    </div>
  );
}

function ThemeToggle() {
  const mode = useThemeStore((s) => s.mode);
  const toggle = useThemeStore((s) => s.toggle);
  const colors = useThemeStore((s) => s.colors);
  const platform = usePlatform();

  const handleToggle = useCallback(async () => {
    toggle();
    const nextMode = mode === 'dark' ? 'light' : 'dark';
    try {
      await platform.setStoredValue('theme', nextMode);
    } catch {}
  }, [mode, toggle, platform]);

  return (
    <button
      onClick={handleToggle}
      title={`Switch to ${mode === 'dark' ? 'light' : 'dark'} theme`}
      style={{
        background: 'transparent',
        border: `1px solid ${colors.border}`,
        borderRadius: 3,
        color: colors.textMuted,
        cursor: 'pointer',
        fontSize: 12,
        fontFamily: 'Inter, sans-serif',
        padding: '2px 6px',
      }}
    >
      {mode === 'dark' ? '☀' : '☾'}
    </button>
  );
}

function RunButton() {
  const isRunning = useSimulationStore((s) => s.isRunning);
  const colors = useThemeStore((s) => s.colors);

  const handleRun = () => {
    import('../../App').then(({ getExecute }) => {
      const execute = getExecute();
      if (execute) execute();
    });
  };

  return (
    <button
      onClick={handleRun}
      disabled={isRunning}
      title="Run Circuit (⌘+Enter)"
      style={{
        padding: '3px 12px',
        background: isRunning ? colors.border : '#00B4D8',
        color: '#fff',
        border: 'none',
        borderRadius: 3,
        cursor: isRunning ? 'default' : 'pointer',
        fontSize: 11,
        fontFamily: 'Inter, sans-serif',
        fontWeight: 600,
      }}
    >
      {isRunning ? 'Running...' : '▶ Run'}
    </button>
  );
}

function ExerciseIndicator() {
  const exercise = useExerciseStore((s) => s.activeExercise);
  const endExercise = useExerciseStore((s) => s.endExercise);
  const colors = useThemeStore((s) => s.colors);

  if (!exercise) return null;

  return (
    <span style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      color: colors.dirac,
      fontSize: 11,
      fontFamily: 'Inter, sans-serif',
    }}>
      <span style={{ fontSize: 10 }}>&#9881;</span>
      {exercise.title}
      <button
        onClick={endExercise}
        title="End exercise"
        style={{
          background: 'none', border: 'none', color: colors.textMuted,
          cursor: 'pointer', fontSize: 10, padding: '0 2px',
        }}
      >
        ✕
      </button>
    </span>
  );
}

function KernelIndicator() {
  const connected = useEditorStore((s) => s.kernelConnected);
  const colors = useThemeStore((s) => s.colors);

  return (
    <span
      title={connected ? 'Kernel connected' : 'Kernel disconnected — click to reconnect'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        color: colors.textMuted,
        fontSize: 11,
        fontFamily: 'Inter, sans-serif',
        cursor: 'default',
      }}
    >
      <span style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        backgroundColor: connected ? '#98C379' : colors.error,
        display: 'inline-block',
      }} />
      Kernel
    </span>
  );
}

export function PanelLayout() {
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [bottomHeight, setBottomHeight] = useState(DEFAULT_BOTTOM_HEIGHT);
  const [bottomCollapsed, setBottomCollapsed] = useState(false);
  const [isDraggingH, setIsDraggingH] = useState(false);
  const [isDraggingV, setIsDraggingV] = useState(false);

  const snapshot = useCircuitStore((s) => s.snapshot);
  const isRunning = useSimulationStore((s) => s.isRunning);
  const result = useSimulationStore((s) => s.result);
  const isDirty = useEditorStore((s) => s.isDirty);
  const colors = useThemeStore((s) => s.colors);
  const platform = usePlatform();

  // Load persisted layout
  useEffect(() => {
    (async () => {
      try {
        const lw = await platform.getStoredValue<number>('layout_leftWidth');
        const bh = await platform.getStoredValue<number>('layout_bottomHeight');
        if (lw) setLeftWidth(lw);
        if (bh) setBottomHeight(bh);
      } catch {}
    })();
  }, [platform]);

  // Persist layout on change (debounced)
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(async () => {
      try {
        await platform.setStoredValue('layout_leftWidth', leftWidth);
        await platform.setStoredValue('layout_bottomHeight', bottomHeight);
      } catch {}
    }, 500);
  }, [leftWidth, bottomHeight]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDraggingH) {
      const pct = (e.clientX / window.innerWidth) * 100;
      setLeftWidth(Math.max(30, Math.min(80, pct)));
    }
    if (isDraggingV) {
      const fromBottom = window.innerHeight - e.clientY;
      setBottomHeight(Math.max(100, Math.min(500, fromBottom)));
    }
  };

  const handleMouseUp = () => {
    setIsDraggingH(false);
    setIsDraggingV(false);
  };

  const statusText = isRunning
    ? 'Running...'
    : result
      ? `Done (${result.execution_time_ms}ms)`
      : 'Ready';

  const effectiveBottomHeight = bottomCollapsed ? 32 : bottomHeight;

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: colors.bg,
        overflow: 'hidden',
        userSelect: isDraggingH || isDraggingV ? 'none' : 'auto',
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Status bar */}
      <div style={{
        height: 28,
        backgroundColor: colors.bgPanel,
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 12,
        fontSize: 12,
        fontFamily: 'Inter, sans-serif',
        flexShrink: 0,
      }}>
        <span style={{ color: colors.accent, fontWeight: 600 }}>
          {isDirty ? '● ' : ''}NUCLEI
        </span>
        <span style={{ color: colors.textMuted }}>|</span>
        <FrameworkSelector />
        <span style={{ color: colors.textMuted }}>
          Qubits: {snapshot ? snapshot.qubit_count : '—'}
        </span>
        <span style={{ color: colors.textMuted }}>
          Depth: {snapshot ? snapshot.depth : '—'}
        </span>
        <div style={{ flex: 1 }} />
        <ExerciseIndicator />
        <KernelIndicator />
        <span style={{ color: isRunning ? colors.accent : colors.textMuted }}>{statusText}</span>
        <RunButton />
        <ThemeToggle />
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Learning sidebar */}
        <LearningPathSidebar />

        {/* Left panel — Editor */}
        <div style={{ width: `${leftWidth}%`, height: '100%', flex: 1, minWidth: 0 }}>
          <QuantumEditor />
        </div>

        {/* Horizontal resize handle */}
        <div
          style={{
            width: 4,
            cursor: 'col-resize',
            backgroundColor: isDraggingH ? colors.accent : colors.border,
            transition: isDraggingH ? 'none' : 'background-color 0.15s',
            flexShrink: 0,
          }}
          onMouseDown={() => setIsDraggingH(true)}
          onDoubleClick={() => setLeftWidth(DEFAULT_LEFT_WIDTH)}
        />

        {/* Right panel — Circuit + Bloch */}
        <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 6, borderBottom: `1px solid ${colors.border}`, overflow: 'hidden' }}>
            <CircuitRenderer />
          </div>
          <div style={{ flex: 4, overflow: 'hidden' }}>
            <BlochPanel />
          </div>
        </div>
      </div>

      {/* Vertical resize handle */}
      {!bottomCollapsed && (
        <div
          style={{
            height: 4,
            cursor: 'row-resize',
            backgroundColor: isDraggingV ? colors.accent : colors.border,
            transition: isDraggingV ? 'none' : 'background-color 0.15s',
            flexShrink: 0,
          }}
          onMouseDown={() => setIsDraggingV(true)}
          onDoubleClick={() => setBottomHeight(DEFAULT_BOTTOM_HEIGHT)}
        />
      )}

      {/* Bottom panel */}
      <div style={{ height: effectiveBottomHeight, overflow: 'hidden', flexShrink: 0 }}>
        <BottomPanel
          collapsed={bottomCollapsed}
          onToggle={() => setBottomCollapsed((c) => !c)}
        />
      </div>
    </div>
  );
}
