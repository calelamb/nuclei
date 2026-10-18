import type { ReactNode } from 'react';
import type { Gate } from '../../types/quantum';
import { useThemeStore } from '../../stores/themeStore';
import { TYPOGRAPHY } from '../../styles/tokens';
import { formatGateParams } from './formatAngle';

// Layout constants (px, at 1x). Compact enough for the 330px rail with room for
// a few layers before the diagram scrolls horizontally.
export const GATE_SIZE = 32;
// Room for a gate box (32), the parameter caption under it (11px) and a clear gap before the next row's box.
export const WIRE_SPACING = 52;
export const LAYER_SPACING = 56;
export const LABEL_WIDTH = 44;
export const PADDING = 20;

const CONTROL_RADIUS = 4.5;
const TARGET_RADIUS = 11;
const GATE_RADIUS = 6;
const LABEL_FONT_SIZE = 13;
const PARAM_FONT_SIZE = 11;

type HoverHandler = (gate: Gate, x: number, y: number) => void;

interface GateProps {
  gate: Gate;
  x: number;
  onHover: HoverHandler;
  onLeave: () => void;
  /** y of the classical register wire, when the circuit has one (measurements drop to it). */
  classicalY?: number;
}

// eslint-disable-next-line react-refresh/only-export-components
export function gateY(qubit: number): number {
  return PADDING + qubit * WIRE_SPACING;
}

/** Shared hover/cursor wrapper so every gate reports the same events. */
function GateGroup({ gate, onHover, onLeave, children }: Pick<GateProps, 'gate' | 'onHover' | 'onLeave'> & { children: ReactNode }) {
  return (
    <g
      onMouseEnter={(e) => onHover(gate, e.clientX, e.clientY)}
      onMouseLeave={onLeave}
      style={{ cursor: 'pointer' }}
      className="nuclei-gate"
    >
      {children}
    </g>
  );
}

function useGatePalette() {
  const colors = useThemeStore((s) => s.colors);
  return {
    box: colors.gateSingle,
    link: colors.gateSingle,
    measure: colors.gateMeasure,
    label: colors.text,
    param: colors.textMuted,
    surface: colors.bg,
  };
}

/** The solid control dot used by every controlled gate. */
function ControlDot({ x, y, color }: { x: number; y: number; color: string }) {
  return <circle cx={x} cy={y} r={CONTROL_RADIUS} fill={color} />;
}

/** The ⊕ target of a controlled-NOT. */
function XorTarget({ x, y, color, surface }: { x: number; y: number; color: string; surface: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={TARGET_RADIUS} fill={surface} stroke={color} strokeWidth={1.5} />
      <line x1={x - TARGET_RADIUS} y1={y} x2={x + TARGET_RADIUS} y2={y} stroke={color} strokeWidth={1.5} />
      <line x1={x} y1={y - TARGET_RADIUS} x2={x} y2={y + TARGET_RADIUS} stroke={color} strokeWidth={1.5} />
    </g>
  );
}

function Link({ x, y0, y1, color }: { x: number; y0: number; y1: number; color: string }) {
  return <line x1={x} y1={Math.min(y0, y1)} x2={x} y2={Math.max(y0, y1)} stroke={color} strokeWidth={1.5} />;
}

function GateBox({ x, y, label, params, palette }: { x: number; y: number; label: string; params: number[]; palette: ReturnType<typeof useGatePalette> }) {
  const half = GATE_SIZE / 2;
  const sub = formatGateParams(params);
  // Wider labels (RZ, SDG, SX) get a little more room rather than overflowing the box.
  const width = label.length > 2 ? GATE_SIZE + (label.length - 2) * 7 : GATE_SIZE;
  return (
    <g>
      <rect
        x={x - width / 2} y={y - half} width={width} height={GATE_SIZE} rx={GATE_RADIUS}
        fill={palette.surface} stroke={palette.box} strokeWidth={1.5}
      />
      <rect
        x={x - width / 2} y={y - half} width={width} height={GATE_SIZE} rx={GATE_RADIUS}
        fill={palette.box} fillOpacity={0.14} stroke="none"
      />
      <text
        x={x} y={y} textAnchor="middle" dominantBaseline="central"
        fill={palette.label} fontSize={LABEL_FONT_SIZE} fontWeight={600} fontFamily={TYPOGRAPHY.fontMono}
      >
        {label}
      </text>
      {sub && (
        <text
          x={x} y={y + half + 11} textAnchor="middle"
          fill={palette.param} fontSize={PARAM_FONT_SIZE} fontFamily={TYPOGRAPHY.fontMono}
        >
          {sub}
        </text>
      )}
    </g>
  );
}

export function SingleQubitGate({ gate, x, onHover, onLeave }: GateProps) {
  const palette = useGatePalette();
  const y = gateY(gate.targets[0]);
  // A controlled single-target gate (CRZ, CH, CP ...) shows its controls.
  const controlYs = gate.controls.map(gateY);
  const ys = [y, ...controlYs];
  return (
    <GateGroup gate={gate} onHover={onHover} onLeave={onLeave}>
      {controlYs.length > 0 && <Link x={x} y0={Math.min(...ys)} y1={Math.max(...ys)} color={palette.link} />}
      {controlYs.map((cy, i) => <ControlDot key={`c${i}`} x={x} y={cy} color={palette.link} />)}
      <GateBox x={x} y={y} label={gate.type} params={gate.params} palette={palette} />
    </GateGroup>
  );
}

export function CNOTGate({ gate, x, onHover, onLeave }: GateProps) {
  const palette = useGatePalette();
  const controlYs = gate.controls.map(gateY);
  const targetY = gateY(gate.targets[0]);
  const all = [targetY, ...controlYs];
  return (
    <GateGroup gate={gate} onHover={onHover} onLeave={onLeave}>
      <Link x={x} y0={Math.min(...all)} y1={Math.max(...all)} color={palette.link} />
      {controlYs.map((cy, i) => <ControlDot key={`c${i}`} x={x} y={cy} color={palette.link} />)}
      <XorTarget x={x} y={targetY} color={palette.link} surface={palette.surface} />
    </GateGroup>
  );
}

export function ToffoliGate(props: GateProps) {
  return <CNOTGate {...props} />;
}

export function SwapGate({ gate, x, onHover, onLeave }: GateProps) {
  const palette = useGatePalette();
  const ys = gate.targets.slice(0, 2).map(gateY);
  const controlYs = gate.controls.map(gateY);
  const all = [...ys, ...controlYs];
  const s = 6;
  return (
    <GateGroup gate={gate} onHover={onHover} onLeave={onLeave}>
      <Link x={x} y0={Math.min(...all)} y1={Math.max(...all)} color={palette.link} />
      {controlYs.map((cy, i) => <ControlDot key={`c${i}`} x={x} y={cy} color={palette.link} />)}
      {ys.map((y, i) => (
        <g key={`s${i}`}>
          <line x1={x - s} y1={y - s} x2={x + s} y2={y + s} stroke={palette.link} strokeWidth={2} strokeLinecap="round" />
          <line x1={x + s} y1={y - s} x2={x - s} y2={y + s} stroke={palette.link} strokeWidth={2} strokeLinecap="round" />
        </g>
      ))}
    </GateGroup>
  );
}

export function CZGate({ gate, x, onHover, onLeave }: GateProps) {
  const palette = useGatePalette();
  const ys = [...gate.controls, ...gate.targets].map(gateY);
  return (
    <GateGroup gate={gate} onHover={onHover} onLeave={onLeave}>
      <Link x={x} y0={Math.min(...ys)} y1={Math.max(...ys)} color={palette.link} />
      {ys.map((y, i) => <ControlDot key={`z${i}`} x={x} y={y} color={palette.link} />)}
    </GateGroup>
  );
}

export function MeasureGate({ gate, x, onHover, onLeave, classicalY }: GateProps) {
  const palette = useGatePalette();
  const y = gateY(gate.targets[0]);
  const half = GATE_SIZE / 2;
  const color = palette.measure;
  return (
    <GateGroup gate={gate} onHover={onHover} onLeave={onLeave}>
      {classicalY !== undefined && (
        <g>
          <line x1={x - 1.5} y1={y + half} x2={x - 1.5} y2={classicalY} stroke={color} strokeWidth={1} />
          <line x1={x + 1.5} y1={y + half} x2={x + 1.5} y2={classicalY} stroke={color} strokeWidth={1} />
          <path d={`M ${x - 4} ${classicalY - 6} L ${x} ${classicalY - 1} L ${x + 4} ${classicalY - 6}`} fill="none" stroke={color} strokeWidth={1.25} />
        </g>
      )}
      <rect x={x - half} y={y - half} width={GATE_SIZE} height={GATE_SIZE} rx={GATE_RADIUS} fill={palette.surface} stroke={color} strokeWidth={1.5} />
      <rect x={x - half} y={y - half} width={GATE_SIZE} height={GATE_SIZE} rx={GATE_RADIUS} fill={color} fillOpacity={0.14} />
      <path d={`M ${x - 9} ${y + 6} A 10 10 0 0 1 ${x + 9} ${y + 6}`} fill="none" stroke={color} strokeWidth={1.5} />
      <line x1={x} y1={y + 6} x2={x + 7} y2={y - 8} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <circle cx={x} cy={y + 6} r={1.75} fill={color} />
    </GateGroup>
  );
}

const CNOT_NAMES = new Set(['CNOT', 'CX', 'CCX', 'TOFFOLI', 'CCNOT', 'MCX']);
const MEASURE_NAMES = new Set(['MEASURE', 'M', 'MZ']);

// eslint-disable-next-line react-refresh/only-export-components
export function renderGate(gate: Gate, x: number, onHover: HoverHandler, onLeave: () => void, classicalY?: number) {
  const props = { gate, x, onHover, onLeave, classicalY };
  const name = gate.type.toUpperCase();
  const key = `${gate.layer}-${gate.targets[0]}-${gate.controls.join('.')}-${name}`;

  if (CNOT_NAMES.has(name) && gate.controls.length > 0) return <CNOTGate key={key} {...props} />;
  if (name === 'SWAP' || name === 'CSWAP' || name === 'FREDKIN') return <SwapGate key={key} {...props} />;
  if (name === 'CZ' || name === 'CCZ') return <CZGate key={key} {...props} />;
  if (MEASURE_NAMES.has(name)) return <MeasureGate key={key} {...props} />;
  return <SingleQubitGate key={key} {...props} />;
}
