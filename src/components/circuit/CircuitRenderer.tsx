import { useState, useRef, useEffect } from 'react';
import { useCircuitStore } from '../../stores/circuitStore';
import { useThemeStore } from '../../stores/themeStore';
import { renderGate, WIRE_SPACING, LAYER_SPACING, LABEL_WIDTH, PADDING, GATE_SIZE } from './gates';
import { getGateData } from '../../data/gates';
import type { Gate } from '../../types/quantum';

interface Tooltip {
  gate: Gate;
  gateIndex: number;
  x: number;
  y: number;
}

interface ContextMenu {
  gateIndex: number;
  gateName: string;
  x: number;
  y: number;
}

function GateExplorerPopup({ gateIndex, onClose }: { gateIndex: number; onClose: () => void }) {
  const snapshot = useCircuitStore((s) => s.snapshot);
  const colors = useThemeStore((s) => s.colors);
  const gate = snapshot?.gates[gateIndex];
  if (!gate) return null;

  const data = getGateData(gate.type);
  if (!data) {
    onClose();
    return null;
  }

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 2000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.4)',
    }} onClick={onClose}>
      <div style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: 20,
        maxWidth: 420,
        width: '90%',
        maxHeight: '80vh',
        overflow: 'auto',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ color: colors.accent, fontWeight: 700, fontSize: 18, fontFamily: "'Fira Code', monospace" }}>
            {data.symbol}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
        <div style={{ color: colors.text, fontSize: 16, fontWeight: 600, fontFamily: 'Inter, sans-serif', marginBottom: 8 }}>
          {data.name}
        </div>
        <div style={{ color: colors.text, fontSize: 13, fontFamily: 'Inter, sans-serif', lineHeight: 1.6, marginBottom: 12 }}>
          {data.description}
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter, sans-serif', marginBottom: 4 }}>MATRIX</div>
          <code style={{ color: colors.accent, fontSize: 12, fontFamily: "'Fira Code', monospace", background: colors.bgPanel, padding: '4px 8px', borderRadius: 4, display: 'block' }}>
            {data.matrix}
          </code>
        </div>

        {data.blochRotation && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter, sans-serif', marginBottom: 4 }}>BLOCH SPHERE EFFECT</div>
            <div style={{ color: colors.text, fontSize: 12, fontFamily: 'Inter, sans-serif' }}>
              Rotation around <strong style={{ color: colors.accentLight }}>{data.blochRotation.axis}</strong> axis by <strong style={{ color: colors.accentLight }}>{data.blochRotation.angle}</strong>
            </div>
          </div>
        )}

        <div style={{ marginBottom: 10 }}>
          <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter, sans-serif', marginBottom: 4 }}>FRAMEWORK SYNTAX</div>
          {Object.entries(data.frameworkSyntax).map(([fw, syntax]) => (
            <div key={fw} style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
              <span style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter, sans-serif', width: 60 }}>{fw}</span>
              <code style={{ color: colors.string, fontSize: 12, fontFamily: "'Fira Code', monospace" }}>{syntax}</code>
            </div>
          ))}
        </div>

        {data.relatedGates.length > 0 && (
          <div>
            <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter, sans-serif', marginBottom: 4 }}>RELATED GATES</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {data.relatedGates.map((g) => (
                <span key={g} style={{ color: colors.accent, fontSize: 12, fontFamily: "'Fira Code', monospace", background: colors.bgPanel, padding: '2px 6px', borderRadius: 3 }}>
                  {g}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepControls() {
  const stepMode = useCircuitStore((s) => s.stepMode);
  const stepIndex = useCircuitStore((s) => s.stepIndex);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const { setStepMode, stepNext, stepPrev, setStepIndex } = useCircuitStore();
  const colors = useThemeStore((s) => s.colors);

  if (!stepMode || !snapshot) return null;

  const totalGates = snapshot.gates.length;

  const btnStyle = {
    padding: '3px 10px',
    background: colors.bgPanel,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: 3,
    cursor: 'pointer' as const,
    fontSize: 11,
    fontFamily: 'Inter, sans-serif',
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 8px',
      borderTop: `1px solid ${colors.border}`,
      background: colors.bgPanel,
    }}>
      <button onClick={stepPrev} disabled={stepIndex <= 0} style={{ ...btnStyle, opacity: stepIndex <= 0 ? 0.4 : 1 }}>◀ Prev</button>
      <button onClick={stepNext} disabled={stepIndex >= totalGates - 1} style={{ ...btnStyle, opacity: stepIndex >= totalGates - 1 ? 0.4 : 1 }}>Next ▶</button>
      <button onClick={() => {
        let i = stepIndex;
        const interval = setInterval(() => {
          i++;
          if (i >= totalGates) { clearInterval(interval); return; }
          setStepIndex(i);
        }, 500);
      }} style={btnStyle}>▶ Play</button>
      <button onClick={() => setStepMode(false)} style={{ ...btnStyle, color: colors.error }}>✕ Exit</button>
      <span style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter, sans-serif', marginLeft: 'auto' }}>
        Step {stepIndex + 1} / {totalGates}
      </span>
    </div>
  );
}

export function CircuitRenderer() {
  const snapshot = useCircuitStore((s) => s.snapshot);
  const error = useCircuitStore((s) => s.error);
  const highlights = useCircuitStore((s) => s.highlights);
  const stepMode = useCircuitStore((s) => s.stepMode);
  const stepIndex = useCircuitStore((s) => s.stepIndex);
  const explorerGateIndex = useCircuitStore((s) => s.explorerGateIndex);
  const setExplorerGateIndex = useCircuitStore((s) => s.setExplorerGateIndex);
  const colors = useThemeStore((s) => s.colors);

  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);

  // Close context menu on click elsewhere
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  const handleHover = (gate: Gate, x: number, y: number, gateIndex: number) => {
    setTooltip({ gate, gateIndex, x, y });
  };
  const handleLeave = () => setTooltip(null);

  const handleContextMenu = (e: React.MouseEvent, gateIndex: number, gateName: string) => {
    e.preventDefault();
    setContextMenu({ gateIndex, gateName, x: e.clientX, y: e.clientY });
  };

  if (!snapshot || snapshot.gates.length === 0) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: colors.textMuted,
        fontSize: 14,
        fontFamily: 'Inter, sans-serif',
      }}>
        {error ? (
          <span style={{ color: colors.error }}>{error}</span>
        ) : (
          'Write quantum code to see the circuit'
        )}
      </div>
    );
  }

  const { qubit_count, depth, gates, classical_bit_count } = snapshot;
  const svgWidth = LABEL_WIDTH + depth * LAYER_SPACING + PADDING * 2;
  const hasClassical = classical_bit_count > 0;
  const classicalWireY = PADDING + qubit_count * WIRE_SPACING + (hasClassical ? 15 : 0);
  const svgHeight = classicalWireY + (hasClassical ? 20 : 0) + PADDING;

  const highlightSet = new Set(highlights.map((h) => h.gateIndex));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: 'auto', position: 'relative' }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ minWidth: svgWidth, minHeight: svgHeight }}
        >
          {/* Qubit wires */}
          {Array.from({ length: qubit_count }, (_, i) => {
            const y = PADDING + i * WIRE_SPACING;
            return (
              <g key={`wire-${i}`}>
                <line
                  x1={LABEL_WIDTH - 10} y1={y}
                  x2={svgWidth - PADDING} y2={y}
                  stroke={colors.wire} strokeWidth={1}
                />
                <text
                  x={LABEL_WIDTH - 20} y={y}
                  textAnchor="end" dominantBaseline="central"
                  fill={colors.text} fontSize={13}
                  fontFamily="'Fira Code', monospace"
                >
                  |{i}⟩
                </text>
              </g>
            );
          })}

          {/* Classical wire */}
          {hasClassical && (
            <g>
              <line x1={LABEL_WIDTH - 10} y1={classicalWireY - 2} x2={svgWidth - PADDING} y2={classicalWireY - 2} stroke={colors.wire} strokeWidth={1} strokeDasharray="4,3" />
              <line x1={LABEL_WIDTH - 10} y1={classicalWireY + 2} x2={svgWidth - PADDING} y2={classicalWireY + 2} stroke={colors.wire} strokeWidth={1} strokeDasharray="4,3" />
              <text x={LABEL_WIDTH - 20} y={classicalWireY} textAnchor="end" dominantBaseline="central" fill={colors.textDim} fontSize={11} fontFamily="'Fira Code', monospace">c</text>
            </g>
          )}

          {/* Gates with highlight/step overlays */}
          {gates.map((gate, idx) => {
            const x = LABEL_WIDTH + gate.layer * LAYER_SPACING + LAYER_SPACING / 2;
            const isHighlighted = highlightSet.has(idx);
            const isGrayedOut = stepMode && idx > stepIndex;
            const opacity = isGrayedOut ? 0.2 : 1;

            return (
              <g
                key={`gate-${idx}`}
                opacity={opacity}
                onContextMenu={(e) => handleContextMenu(e, idx, gate.type)}
              >
                {/* Highlight glow */}
                {isHighlighted && !isGrayedOut && (
                  <circle
                    cx={x}
                    cy={PADDING + (gate.targets[0] ?? 0) * WIRE_SPACING}
                    r={GATE_SIZE / 2 + 6}
                    fill="none"
                    stroke={colors.accent}
                    strokeWidth={2}
                    opacity={0.6}
                  >
                    <animate attributeName="opacity" values="0.6;0.2;0.6" dur="1.5s" repeatCount="indefinite" />
                  </circle>
                )}
                {renderGate(gate, x, (g, mx, my) => handleHover(g, mx, my, idx), handleLeave)}
              </g>
            );
          })}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div style={{
            position: 'fixed',
            left: tooltip.x + 12, top: tooltip.y - 8,
            backgroundColor: colors.bgPanel,
            border: `1px solid ${colors.border}`,
            borderRadius: 6, padding: '8px 12px',
            zIndex: 1000, pointerEvents: 'none', maxWidth: 250,
          }}>
            <div style={{ color: colors.accent, fontWeight: 600, fontSize: 13, fontFamily: "'Fira Code', monospace" }}>{tooltip.gate.type}</div>
            <div style={{ color: colors.text, fontSize: 12, fontFamily: 'Inter, sans-serif', marginTop: 4 }}>Targets: q{tooltip.gate.targets.join(', q')}</div>
            {tooltip.gate.controls.length > 0 && <div style={{ color: colors.text, fontSize: 12, fontFamily: 'Inter, sans-serif' }}>Controls: q{tooltip.gate.controls.join(', q')}</div>}
            {tooltip.gate.params.length > 0 && <div style={{ color: colors.number, fontSize: 12, fontFamily: "'Fira Code', monospace" }}>Params: {tooltip.gate.params.map(p => p.toFixed(4)).join(', ')}</div>}
            <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter, sans-serif', marginTop: 2 }}>Layer {tooltip.gate.layer} • Right-click to explore</div>
          </div>
        )}

        {/* Context menu */}
        {contextMenu && (
          <div style={{
            position: 'fixed',
            left: contextMenu.x, top: contextMenu.y,
            background: colors.bgPanel,
            border: `1px solid ${colors.border}`,
            borderRadius: 4, overflow: 'hidden',
            zIndex: 1500, minWidth: 160,
          }}>
            <button
              onClick={() => { setExplorerGateIndex(contextMenu.gateIndex); setContextMenu(null); }}
              style={{ display: 'block', width: '100%', padding: '8px 12px', background: 'transparent', color: colors.text, border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'Inter, sans-serif', textAlign: 'left' }}
              onMouseEnter={(e) => (e.target as HTMLElement).style.background = colors.border}
              onMouseLeave={(e) => (e.target as HTMLElement).style.background = 'transparent'}
            >
              Explore {contextMenu.gateName} gate
            </button>
            <button
              onClick={() => {
                useCircuitStore.getState().setStepMode(true);
                useCircuitStore.getState().setStepIndex(contextMenu.gateIndex);
                setContextMenu(null);
              }}
              style={{ display: 'block', width: '100%', padding: '8px 12px', background: 'transparent', color: colors.text, border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'Inter, sans-serif', textAlign: 'left' }}
              onMouseEnter={(e) => (e.target as HTMLElement).style.background = colors.border}
              onMouseLeave={(e) => (e.target as HTMLElement).style.background = 'transparent'}
            >
              Step through from here
            </button>
          </div>
        )}
      </div>

      {/* Step controls */}
      <StepControls />

      {/* Gate explorer popup */}
      {explorerGateIndex !== null && (
        <GateExplorerPopup
          gateIndex={explorerGateIndex}
          onClose={() => setExplorerGateIndex(null)}
        />
      )}
    </div>
  );
}
