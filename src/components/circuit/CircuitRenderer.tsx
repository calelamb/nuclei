import { useState, useRef, useEffect, useCallback } from 'react';
import { useCircuitStore } from '../../stores/circuitStore';
import { useDebugStore } from '../../stores/debugStore';
import { activeDebugStep } from '../../lib/debugTrace';
import { useThemeStore } from '../../stores/themeStore';
import { renderGate, gateY, WIRE_SPACING, LAYER_SPACING, LABEL_WIDTH, PADDING, GATE_SIZE } from './gates';
import { formatAngle } from './formatAngle';
import { CircuitEmptyState } from './CircuitEmptyState';
import { getGateData } from '../../data/gates';
import { useCircuitExport } from '../../hooks/useCircuitExport';
import type { Gate } from '../../types/quantum';

import { TYPOGRAPHY } from '../../styles/tokens';
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
          <span style={{ color: colors.accent, fontWeight: 700, fontSize: 16, fontFamily: TYPOGRAPHY.fontMono }}>
            {data.symbol}
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
        <div style={{ color: colors.text, fontSize: 16, fontWeight: 600, fontFamily: TYPOGRAPHY.fontSans, marginBottom: 8 }}>
          {data.name}
        </div>
        <div style={{ color: colors.text, fontSize: 13, fontFamily: TYPOGRAPHY.fontSans, lineHeight: 1.6, marginBottom: 12 }}>
          {data.description}
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, marginBottom: 4 }}>MATRIX</div>
          <code style={{ color: colors.accent, fontSize: 12, fontFamily: TYPOGRAPHY.fontMono, background: colors.bgPanel, padding: '4px 8px', borderRadius: 4, display: 'block' }}>
            {data.matrix}
          </code>
        </div>

        {data.blochRotation && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, marginBottom: 4 }}>BLOCH SPHERE EFFECT</div>
            <div style={{ color: colors.text, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans }}>
              Rotation around <strong style={{ color: colors.accentLight }}>{data.blochRotation.axis}</strong> axis by <strong style={{ color: colors.accentLight }}>{data.blochRotation.angle}</strong>
            </div>
          </div>
        )}

        <div style={{ marginBottom: 10 }}>
          <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, marginBottom: 4 }}>FRAMEWORK SYNTAX</div>
          {Object.entries(data.frameworkSyntax).map(([fw, syntax]) => (
            <div key={fw} style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
              <span style={{ color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, width: 60 }}>{fw}</span>
              <code style={{ color: colors.string, fontSize: 12, fontFamily: TYPOGRAPHY.fontMono }}>{syntax}</code>
            </div>
          ))}
        </div>

        {data.relatedGates.length > 0 && (
          <div>
            <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, marginBottom: 4 }}>RELATED GATES</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {data.relatedGates.map((g) => (
                <span key={g} style={{ color: colors.accent, fontSize: 12, fontFamily: TYPOGRAPHY.fontMono, background: colors.bgPanel, padding: '2px 6px', borderRadius: 3 }}>
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

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const colors = useThemeStore((s) => s.colors);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const { exportQasmFile, exportSvg, exportPng, copyCodeToClipboard, copyQasmToClipboard, copyShareUrl, exportJsonSnapshot } = useCircuitExport();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!snapshot || snapshot.gates.length === 0) return null;

  const items = [
    { label: 'Copy code', action: () => { copyCodeToClipboard(); setOpen(false); } },
    { label: 'Copy QASM', action: () => { copyQasmToClipboard(); setOpen(false); } },
    { label: 'Copy share URL', action: () => { copyShareUrl(); setOpen(false); } },
    { label: 'Export QASM file', action: () => { exportQasmFile(); setOpen(false); } },
    { label: 'Export SVG', action: () => { exportSvg(); setOpen(false); } },
    { label: 'Export PNG (2x)', action: () => { exportPng(2); setOpen(false); } },
    { label: 'Export JSON', action: () => { exportJsonSnapshot(); setOpen(false); } },
  ];

  return (
    <div ref={menuRef} style={{ position: 'relative', zIndex: 100 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          padding: '3px 8px', background: colors.bgPanel, color: colors.textMuted,
          border: `1px solid ${colors.border}`, borderRadius: 3, cursor: 'pointer',
          fontSize: 11, fontFamily: TYPOGRAPHY.fontSans,
        }}
      >
        Export ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 2,
          background: colors.bgPanel, border: `1px solid ${colors.border}`,
          borderRadius: 4, overflow: 'hidden', minWidth: 150,
        }}>
          {items.map((item) => (
            <button
              key={item.label}
              onClick={item.action}
              className="nuclei-menu-item"
              style={{
                display: 'block', width: '100%', padding: '6px 12px',
                background: 'transparent', color: colors.text, border: 'none',
                cursor: 'pointer', fontSize: 12, fontFamily: TYPOGRAPHY.fontSans, textAlign: 'left',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StepControls() {
  const stepMode = useCircuitStore((s) => s.stepMode);
  const stepIndex = useCircuitStore((s) => s.stepIndex);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const { setStepMode, stepNext, stepPrev, setStepIndex } = useCircuitStore();
  const colors = useThemeStore((s) => s.colors);

  // Tracked interval handle so the Play loop can be stopped when the user
  // exits step mode, clicks Play again, or the component unmounts. Without
  // this the previous implementation could leak multiple intervals.
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const stopPlay = useCallback(() => {
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  // Stop playback when stepMode is turned off elsewhere, and on unmount.
  useEffect(() => {
    if (!stepMode) stopPlay();
  }, [stepMode, stopPlay]);
  useEffect(() => () => stopPlay(), [stopPlay]);

  if (!stepMode || !snapshot) return null;

  const totalGates = snapshot.gates.length;

  const handlePlay = () => {
    if (isPlaying) {
      stopPlay();
      return;
    }
    setIsPlaying(true);
    let i = useCircuitStore.getState().stepIndex;
    playIntervalRef.current = setInterval(() => {
      i++;
      if (i >= totalGates) {
        stopPlay();
        return;
      }
      setStepIndex(i);
    }, 500);
  };

  const btnStyle = {
    padding: '3px 10px',
    background: colors.bgPanel,
    color: colors.text,
    border: `1px solid ${colors.border}`,
    borderRadius: 3,
    cursor: 'pointer' as const,
    fontSize: 11,
    fontFamily: TYPOGRAPHY.fontSans,
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
      <button onClick={handlePlay} style={btnStyle}>{isPlaying ? '⏸ Pause' : '▶ Play'}</button>
      <button onClick={() => setStepMode(false)} style={{ ...btnStyle, color: colors.error }}>✕ Exit</button>
      <DebugStateReadout stepIndex={stepIndex} />
      <span style={{ color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, marginLeft: 'auto' }}>
        Step {stepIndex + 1} / {totalGates}
      </span>
    </div>
  );
}

/** The Quantum Debugger's per-step state status shown in the step controls:
 * the state being inspected, or the compute/error state of the trace fetch. */
function DebugStateReadout({ stepIndex }: { stepIndex: number }) {
  const colors = useThemeStore((s) => s.colors);
  const pending = useDebugStore((s) => s.pending);
  const error = useDebugStore((s) => s.error);
  const trace = useDebugStore((s) => s.trace);

  const base = { fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, marginLeft: 10 } as const;
  if (pending) return <span style={{ ...base, color: colors.textMuted }}>computing state…</span>;
  if (error) return <span style={{ ...base, color: colors.textMuted }}>{error}</span>;

  const step = activeDebugStep(trace, stepIndex);
  if (!step) return null;
  return (
    <span style={{ ...base, color: colors.accent }}>
      state after {step.gate_index < 0 ? 'start' : step.label}
    </span>
  );
}

/** Generate a screen-reader-friendly description of the circuit */
function describeCircuit(snapshot: import('../../types/quantum').CircuitSnapshot): string {
  const gates = snapshot.gates;
  const gateTypes = [...new Set(gates.map((g) => g.type))];
  const gateList = gates.map((g) => {
    const targets = g.targets.map((t) => `qubit ${t}`).join(' and ');
    const controls = g.controls.length > 0 ? `, controlled by qubit ${g.controls.join(' and qubit ')}` : '';
    return `${g.type} on ${targets}${controls}`;
  }).join('; ');

  return `${snapshot.qubit_count}-qubit circuit with depth ${snapshot.depth}. Gates: ${gateTypes.join(', ')}. Sequence: ${gateList}.`;
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
    return <CircuitEmptyState error={error} />;
  }

  const { qubit_count, depth, gates, classical_bit_count } = snapshot;
  const hasClassical = classical_bit_count > 0;
  const layerCount = Math.max(depth, ...gates.map((g) => g.layer + 1));
  const svgWidth = LABEL_WIDTH + layerCount * LAYER_SPACING + PADDING;
  const lastQubitY = PADDING + (qubit_count - 1) * WIRE_SPACING;
  const classicalWireY = lastQubitY + WIRE_SPACING * 0.9;
  const svgHeight = (hasClassical ? classicalWireY : lastQubitY) + PADDING + 8;
  const wireStart = LABEL_WIDTH - 8;
  const wireEnd = svgWidth - PADDING / 2;

  const highlightSet = new Set(highlights.map((h) => h.gateIndex));

  const ariaDescription = describeCircuit(snapshot);

  return (
    <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }} role="region" aria-label="Circuit diagram">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px 0 12px', flexShrink: 0 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: colors.textDim, fontFamily: TYPOGRAPHY.fontSans }}>
            Circuit
          </span>
          <span style={{ fontSize: 11, color: colors.textDim, fontFamily: TYPOGRAPHY.fontSans, whiteSpace: 'nowrap' }}>
            {qubit_count} {qubit_count === 1 ? 'qubit' : 'qubits'} · depth {depth}
          </span>
        </span>
        <ExportMenu />
      </div>
      <div
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative', padding: '4px 0 6px' }}
        aria-description={ariaDescription}
      >
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ display: 'block', margin: '0 auto', minWidth: svgWidth }}
          role="img"
          aria-label={ariaDescription}
        >
          {/* Qubit wires */}
          {Array.from({ length: qubit_count }, (_, i) => {
            const y = gateY(i);
            return (
              <g key={`wire-${i}`}>
                <line x1={wireStart} y1={y} x2={wireEnd} y2={y} stroke={colors.wire} strokeWidth={1.25} />
                <text
                  x={LABEL_WIDTH - 18} y={y}
                  textAnchor="end" dominantBaseline="central"
                  fill={colors.textMuted} fontSize={12}
                  fontFamily={TYPOGRAPHY.fontMono}
                >
                  q{i}
                </text>
              </g>
            );
          })}

          {/* Classical register: a double wire, the OpenQASM / Quirk convention. */}
          {hasClassical && (
            <g>
              <line x1={wireStart} y1={classicalWireY - 1.5} x2={wireEnd} y2={classicalWireY - 1.5} stroke={colors.wire} strokeWidth={1} />
              <line x1={wireStart} y1={classicalWireY + 1.5} x2={wireEnd} y2={classicalWireY + 1.5} stroke={colors.wire} strokeWidth={1} />
              <text x={LABEL_WIDTH - 18} y={classicalWireY} textAnchor="end" dominantBaseline="central" fill={colors.textDim} fontSize={12} fontFamily={TYPOGRAPHY.fontMono}>
                c{classical_bit_count > 1 ? `/${classical_bit_count}` : ''}
              </text>
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
                {/* Highlight glow — CSS animation instead of SVG SMIL so it
                    keeps ticking smoothly across re-renders and matches the
                    rest of the app's motion vocabulary. */}
                {isHighlighted && !isGrayedOut && (
                  <circle
                    cx={x}
                    cy={gateY(gate.targets[0] ?? 0)}
                    r={GATE_SIZE / 2 + 6}
                    fill="none"
                    stroke={colors.accent}
                    strokeWidth={2}
                    style={{
                      animation: 'nuclei-pulse 1.5s ease-in-out infinite',
                      transformOrigin: 'center',
                    }}
                  />
                )}
                {renderGate(gate, x, (g, mx, my) => handleHover(g, mx, my, idx), handleLeave, hasClassical ? classicalWireY : undefined)}
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
            <div style={{ color: colors.accent, fontWeight: 600, fontSize: 13, fontFamily: TYPOGRAPHY.fontMono }}>{tooltip.gate.type}</div>
            <div style={{ color: colors.text, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans, marginTop: 4 }}>Targets: q{tooltip.gate.targets.join(', q')}</div>
            {tooltip.gate.controls.length > 0 && <div style={{ color: colors.text, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans }}>Controls: q{tooltip.gate.controls.join(', q')}</div>}
            {tooltip.gate.params.length > 0 && <div style={{ color: colors.number, fontSize: 12, fontFamily: TYPOGRAPHY.fontMono }}>Params: {tooltip.gate.params.map(formatAngle).join(', ')}</div>}
            <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, marginTop: 2 }}>Layer {tooltip.gate.layer} • Right-click to explore</div>
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
              className="nuclei-menu-item"
              style={{ display: 'block', width: '100%', padding: '8px 12px', background: 'transparent', color: colors.text, border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: TYPOGRAPHY.fontSans, textAlign: 'left' }}
            >
              Explore {contextMenu.gateName} gate
            </button>
            <button
              className="nuclei-menu-item"
              onClick={() => {
                useCircuitStore.getState().setStepMode(true);
                useCircuitStore.getState().setStepIndex(contextMenu.gateIndex);
                setContextMenu(null);
              }}
              style={{ display: 'block', width: '100%', padding: '8px 12px', background: 'transparent', color: colors.text, border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: TYPOGRAPHY.fontSans, textAlign: 'left' }}
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
