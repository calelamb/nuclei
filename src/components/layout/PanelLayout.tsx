import { useState, useRef, useEffect } from 'react';
import { QuantumEditor } from '../editor/QuantumEditor';
import { CircuitRenderer } from '../circuit/CircuitRenderer';
import { useEditorStore } from '../../stores/editorStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { useSimulationStore } from '../../stores/simulationStore';

function BlochPanel() {
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#3D5A80',
      fontSize: 14,
      fontFamily: 'Inter, sans-serif',
    }}>
      Bloch sphere will render here
    </div>
  );
}

function TerminalPanel() {
  const { terminalOutput } = useSimulationStore();
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
        color: '#E0E0E0',
        padding: 12,
      }}
    >
      {terminalOutput.length === 0 ? (
        <span style={{ color: '#3D5A80' }}>Terminal output will appear here</span>
      ) : (
        terminalOutput.map((line, i) => (
          <div key={i} style={{ color: line.startsWith('Error') ? '#E06C75' : '#E0E0E0' }}>
            {line}
          </div>
        ))
      )}
    </div>
  );
}

function BottomPanel() {
  const [activeTab, setActiveTab] = useState<'terminal' | 'histogram' | 'dirac'>('terminal');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex',
        borderBottom: '1px solid #1A2A42',
        backgroundColor: '#0A1220',
      }}>
        {(['terminal', 'histogram', 'dirac'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 16px',
              background: activeTab === tab ? '#0F1B2D' : 'transparent',
              color: activeTab === tab ? '#00B4D8' : '#3D5A80',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #00B4D8' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'Inter, sans-serif',
              textTransform: 'capitalize',
            }}
          >
            {tab === 'dirac' ? 'Dirac AI' : tab}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'terminal' && <TerminalPanel />}
        {activeTab === 'histogram' && (
          <div style={{ padding: 12, color: '#3D5A80', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
            Probability histogram will render here
          </div>
        )}
        {activeTab === 'dirac' && (
          <div style={{ padding: 12, color: '#3D5A80', fontSize: 13, fontFamily: 'Inter, sans-serif' }}>
            Dirac AI assistant will live here
          </div>
        )}
      </div>
    </div>
  );
}

export function PanelLayout() {
  const [leftWidth, setLeftWidth] = useState(60);
  const [bottomHeight, setBottomHeight] = useState(200);
  const [isDraggingH, setIsDraggingH] = useState(false);
  const [isDraggingV, setIsDraggingV] = useState(false);

  const framework = useEditorStore((s) => s.framework);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const isRunning = useSimulationStore((s) => s.isRunning);
  const result = useSimulationStore((s) => s.result);

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

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#0F1B2D',
        overflow: 'hidden',
        userSelect: isDraggingH || isDraggingV ? 'none' : 'auto',
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Status bar */}
      <div style={{
        height: 28,
        backgroundColor: '#0A1220',
        borderBottom: '1px solid #1A2A42',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 16,
        fontSize: 12,
        fontFamily: 'Inter, sans-serif',
        flexShrink: 0,
      }}>
        <span style={{ color: '#00B4D8', fontWeight: 600 }}>NUCLEI</span>
        <span style={{ color: '#3D5A80' }}>|</span>
        <span style={{ color: '#48CAE4' }}>{framework.charAt(0).toUpperCase() + framework.slice(1)}</span>
        <span style={{ color: '#3D5A80' }}>
          Qubits: {snapshot ? snapshot.qubit_count : '—'}
        </span>
        <span style={{ color: '#3D5A80' }}>
          Depth: {snapshot ? snapshot.depth : '—'}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ color: isRunning ? '#00B4D8' : '#3D5A80' }}>{statusText}</span>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left panel — Editor */}
        <div style={{ width: `${leftWidth}%`, height: '100%' }}>
          <QuantumEditor />
        </div>

        {/* Horizontal resize handle */}
        <div
          style={{
            width: 4,
            cursor: 'col-resize',
            backgroundColor: isDraggingH ? '#00B4D8' : '#1A2A42',
            transition: isDraggingH ? 'none' : 'background-color 0.15s',
            flexShrink: 0,
          }}
          onMouseDown={() => setIsDraggingH(true)}
          onMouseEnter={(e) => {
            if (!isDraggingH) (e.target as HTMLElement).style.backgroundColor = '#264F78';
          }}
          onMouseLeave={(e) => {
            if (!isDraggingH) (e.target as HTMLElement).style.backgroundColor = '#1A2A42';
          }}
        />

        {/* Right panel — Circuit + Bloch */}
        <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 6, borderBottom: '1px solid #1A2A42', overflow: 'hidden' }}>
            <CircuitRenderer />
          </div>
          <div style={{ flex: 4, overflow: 'hidden' }}>
            <BlochPanel />
          </div>
        </div>
      </div>

      {/* Vertical resize handle */}
      <div
        style={{
          height: 4,
          cursor: 'row-resize',
          backgroundColor: isDraggingV ? '#00B4D8' : '#1A2A42',
          transition: isDraggingV ? 'none' : 'background-color 0.15s',
          flexShrink: 0,
        }}
        onMouseDown={() => setIsDraggingV(true)}
      />

      {/* Bottom panel */}
      <div style={{ height: bottomHeight, overflow: 'hidden', flexShrink: 0 }}>
        <BottomPanel />
      </div>
    </div>
  );
}
