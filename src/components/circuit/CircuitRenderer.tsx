import { useState, useRef, useEffect } from 'react';
import { useCircuitStore } from '../../stores/circuitStore';
import { renderGate, WIRE_SPACING, LAYER_SPACING, LABEL_WIDTH, PADDING, GATE_SIZE } from './gates';
import type { Gate } from '../../types/quantum';

interface Tooltip {
  gate: Gate;
  x: number;
  y: number;
}

export function CircuitRenderer() {
  const snapshot = useCircuitStore((s) => s.snapshot);
  const error = useCircuitStore((s) => s.error);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  const handleHover = (gate: Gate, x: number, y: number) => {
    setTooltip({ gate, x, y });
  };
  const handleLeave = () => setTooltip(null);

  if (!snapshot || snapshot.gates.length === 0) {
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
        {error ? (
          <span style={{ color: '#E06C75' }}>{error}</span>
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

  return (
    <div
      ref={containerRef}
      style={{
        height: '100%',
        overflow: 'auto',
        position: 'relative',
      }}
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
                x1={LABEL_WIDTH - 10}
                y1={y}
                x2={svgWidth - PADDING}
                y2={y}
                stroke="#3D5A80"
                strokeWidth={1}
              />
              <text
                x={LABEL_WIDTH - 20}
                y={y}
                textAnchor="end"
                dominantBaseline="central"
                fill="#E0E0E0"
                fontSize={13}
                fontFamily="'Fira Code', monospace"
              >
                |{i}⟩
              </text>
            </g>
          );
        })}

        {/* Classical wire (double line) */}
        {hasClassical && (
          <g>
            <line
              x1={LABEL_WIDTH - 10}
              y1={classicalWireY - 2}
              x2={svgWidth - PADDING}
              y2={classicalWireY - 2}
              stroke="#3D5A80"
              strokeWidth={1}
              strokeDasharray="4,3"
            />
            <line
              x1={LABEL_WIDTH - 10}
              y1={classicalWireY + 2}
              x2={svgWidth - PADDING}
              y2={classicalWireY + 2}
              stroke="#3D5A80"
              strokeWidth={1}
              strokeDasharray="4,3"
            />
            <text
              x={LABEL_WIDTH - 20}
              y={classicalWireY}
              textAnchor="end"
              dominantBaseline="central"
              fill="#6A737D"
              fontSize={11}
              fontFamily="'Fira Code', monospace"
            >
              c
            </text>
          </g>
        )}

        {/* Gates */}
        {gates.map((gate) => {
          const x = LABEL_WIDTH + gate.layer * LAYER_SPACING + LAYER_SPACING / 2;
          return renderGate(gate, x, handleHover, handleLeave);
        })}
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'fixed',
            left: tooltip.x + 12,
            top: tooltip.y - 8,
            backgroundColor: '#0A1220',
            border: '1px solid #1A2A42',
            borderRadius: 6,
            padding: '8px 12px',
            zIndex: 1000,
            pointerEvents: 'none',
            maxWidth: 250,
          }}
        >
          <div style={{ color: '#00B4D8', fontWeight: 600, fontSize: 13, fontFamily: "'Fira Code', monospace" }}>
            {tooltip.gate.type}
          </div>
          <div style={{ color: '#E0E0E0', fontSize: 12, fontFamily: 'Inter, sans-serif', marginTop: 4 }}>
            Targets: q{tooltip.gate.targets.join(', q')}
          </div>
          {tooltip.gate.controls.length > 0 && (
            <div style={{ color: '#E0E0E0', fontSize: 12, fontFamily: 'Inter, sans-serif' }}>
              Controls: q{tooltip.gate.controls.join(', q')}
            </div>
          )}
          {tooltip.gate.params.length > 0 && (
            <div style={{ color: '#D19A66', fontSize: 12, fontFamily: "'Fira Code', monospace" }}>
              Params: {tooltip.gate.params.map(p => p.toFixed(4)).join(', ')}
            </div>
          )}
          <div style={{ color: '#3D5A80', fontSize: 11, fontFamily: 'Inter, sans-serif', marginTop: 2 }}>
            Layer {tooltip.gate.layer}
          </div>
        </div>
      )}
    </div>
  );
}
