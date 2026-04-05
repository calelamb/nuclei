import type { Gate } from '../../types/quantum';

// Layout constants
export const GATE_SIZE = 40;
export const WIRE_SPACING = 50;
export const LAYER_SPACING = 70;
export const LABEL_WIDTH = 50;
export const PADDING = 20;

const COLORS = {
  singleQubit: '#00B4D8',
  multiQubit: '#1E3A5F',
  measurement: '#6A737D',
  wire: '#3D5A80',
  text: '#E0E0E0',
  controlDot: '#00B4D8',
};

interface GateProps {
  gate: Gate;
  x: number;
  onHover: (gate: Gate, x: number, y: number) => void;
  onLeave: () => void;
}

function gateY(qubit: number): number {
  return PADDING + qubit * WIRE_SPACING;
}

export function SingleQubitGate({ gate, x, onHover, onLeave }: GateProps) {
  const y = gateY(gate.targets[0]);
  const halfSize = GATE_SIZE / 2;

  return (
    <g
      onMouseEnter={(e) => onHover(gate, e.clientX, e.clientY)}
      onMouseLeave={onLeave}
      style={{ cursor: 'pointer' }}
      className="nuclei-gate"
    >
      {/* Drop shadow */}
      <rect
        x={x - halfSize + 1}
        y={y - halfSize + 2}
        width={GATE_SIZE}
        height={GATE_SIZE}
        rx={6}
        fill="rgba(0,0,0,0.2)"
      />
      {/* Main gate body */}
      <rect
        x={x - halfSize}
        y={y - halfSize}
        width={GATE_SIZE}
        height={GATE_SIZE}
        rx={6}
        fill={COLORS.singleQubit}
        fillOpacity={0.12}
        stroke={COLORS.singleQubit}
        strokeWidth={1.5}
      />
      {/* Subtle top highlight */}
      <rect
        x={x - halfSize + 1}
        y={y - halfSize + 1}
        width={GATE_SIZE - 2}
        height={4}
        rx={4}
        fill={COLORS.singleQubit}
        fillOpacity={0.08}
      />
      <text
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        fill={COLORS.singleQubit}
        fontSize={14}
        fontFamily="'JetBrains Mono', monospace"
        fontWeight={600}
      >
        {gate.type}
      </text>
      {gate.params.length > 0 && (
        <text
          x={x}
          y={y + halfSize + 12}
          textAnchor="middle"
          fill={COLORS.wire}
          fontSize={10}
          fontFamily="'JetBrains Mono', monospace"
        >
          {gate.params.map(p => p.toFixed(2)).join(', ')}
        </text>
      )}
    </g>
  );
}

export function CNOTGate({ gate, x, onHover, onLeave }: GateProps) {
  const controlY = gateY(gate.controls[0]);
  const targetY = gateY(gate.targets[0]);
  const radius = 12;

  return (
    <g
      onMouseEnter={(e) => onHover(gate, e.clientX, e.clientY)}
      onMouseLeave={onLeave}
      style={{ cursor: 'pointer' }}
      className="nuclei-gate"
    >
      {/* Vertical connecting line */}
      <line
        x1={x} y1={controlY}
        x2={x} y2={targetY}
        stroke={COLORS.multiQubit}
        strokeWidth={2}
      />
      {/* Control dot with radial gradient */}
      <defs>
        <radialGradient id={`ctrl-grad-${gate.layer}-${gate.controls[0]}`}>
          <stop offset="0%" stopColor={COLORS.controlDot} stopOpacity="1" />
          <stop offset="100%" stopColor={COLORS.controlDot} stopOpacity="0.6" />
        </radialGradient>
      </defs>
      <circle cx={x} cy={controlY} r={6} fill={`url(#ctrl-grad-${gate.layer}-${gate.controls[0]})`} />
      {/* Target circle-plus */}
      <circle cx={x} cy={targetY} r={radius} fill="none" stroke={COLORS.multiQubit} strokeWidth={2} />
      <line x1={x - radius} y1={targetY} x2={x + radius} y2={targetY} stroke={COLORS.multiQubit} strokeWidth={1.5} />
      <line x1={x} y1={targetY - radius} x2={x} y2={targetY + radius} stroke={COLORS.multiQubit} strokeWidth={1.5} />
    </g>
  );
}

export function ToffoliGate({ gate, x, onHover, onLeave }: GateProps) {
  const [c0, c1] = gate.controls;
  const targetY = gateY(gate.targets[0]);
  const allY = [...gate.controls.map(gateY), targetY];
  const minY = Math.min(...allY);
  const maxY = Math.max(...allY);
  const radius = 12;

  return (
    <g
      onMouseEnter={(e) => onHover(gate, e.clientX, e.clientY)}
      onMouseLeave={onLeave}
      style={{ cursor: 'pointer' }}
      className="nuclei-gate"
    >
      <line x1={x} y1={minY} x2={x} y2={maxY} stroke={COLORS.multiQubit} strokeWidth={2} />
      <circle cx={x} cy={gateY(c0)} r={6} fill={COLORS.controlDot} />
      <circle cx={x} cy={gateY(c1)} r={6} fill={COLORS.controlDot} />
      <circle cx={x} cy={targetY} r={radius} fill="none" stroke={COLORS.multiQubit} strokeWidth={2} />
      <line x1={x - radius} y1={targetY} x2={x + radius} y2={targetY} stroke={COLORS.multiQubit} strokeWidth={1.5} />
      <line x1={x} y1={targetY - radius} x2={x} y2={targetY + radius} stroke={COLORS.multiQubit} strokeWidth={1.5} />
    </g>
  );
}

export function SwapGate({ gate, x, onHover, onLeave }: GateProps) {
  const y0 = gateY(gate.targets[0]);
  const y1 = gateY(gate.targets[1]);
  const s = 8;

  return (
    <g
      onMouseEnter={(e) => onHover(gate, e.clientX, e.clientY)}
      onMouseLeave={onLeave}
      style={{ cursor: 'pointer' }}
      className="nuclei-gate"
    >
      <line x1={x} y1={y0} x2={x} y2={y1} stroke={COLORS.multiQubit} strokeWidth={2} />
      <line x1={x - s} y1={y0 - s} x2={x + s} y2={y0 + s} stroke={COLORS.multiQubit} strokeWidth={2} />
      <line x1={x + s} y1={y0 - s} x2={x - s} y2={y0 + s} stroke={COLORS.multiQubit} strokeWidth={2} />
      <line x1={x - s} y1={y1 - s} x2={x + s} y2={y1 + s} stroke={COLORS.multiQubit} strokeWidth={2} />
      <line x1={x + s} y1={y1 - s} x2={x - s} y2={y1 + s} stroke={COLORS.multiQubit} strokeWidth={2} />
    </g>
  );
}

export function MeasureGate({ gate, x, onHover, onLeave }: GateProps) {
  const y = gateY(gate.targets[0]);
  const halfSize = GATE_SIZE / 2;

  return (
    <g
      onMouseEnter={(e) => onHover(gate, e.clientX, e.clientY)}
      onMouseLeave={onLeave}
      style={{ cursor: 'pointer' }}
      className="nuclei-gate"
    >
      {/* Drop shadow */}
      <rect
        x={x - halfSize + 1}
        y={y - halfSize + 2}
        width={GATE_SIZE}
        height={GATE_SIZE}
        rx={4}
        fill="rgba(0,0,0,0.15)"
      />
      <rect
        x={x - halfSize}
        y={y - halfSize}
        width={GATE_SIZE}
        height={GATE_SIZE}
        rx={4}
        fill={COLORS.measurement}
        fillOpacity={0.12}
        stroke={COLORS.measurement}
        strokeWidth={1.5}
      />
      {/* Meter arc */}
      <path
        d={`M ${x - 10} ${y + 6} A 12 12 0 0 1 ${x + 10} ${y + 6}`}
        fill="none"
        stroke={COLORS.measurement}
        strokeWidth={1.5}
      />
      {/* Meter needle */}
      <line
        x1={x}
        y1={y + 6}
        x2={x + 8}
        y2={y - 10}
        stroke={COLORS.measurement}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {/* Meter base dot */}
      <circle cx={x} cy={y + 6} r={2} fill={COLORS.measurement} />
    </g>
  );
}

export function CZGate({ gate, x, onHover, onLeave }: GateProps) {
  const y0 = gateY(gate.controls[0]);
  const y1 = gateY(gate.targets[0]);

  return (
    <g
      onMouseEnter={(e) => onHover(gate, e.clientX, e.clientY)}
      onMouseLeave={onLeave}
      style={{ cursor: 'pointer' }}
      className="nuclei-gate"
    >
      <line x1={x} y1={y0} x2={x} y2={y1} stroke={COLORS.multiQubit} strokeWidth={2} />
      <circle cx={x} cy={y0} r={6} fill={COLORS.controlDot} />
      <circle cx={x} cy={y1} r={6} fill={COLORS.controlDot} />
    </g>
  );
}

export function renderGate(gate: Gate, x: number, onHover: GateProps['onHover'], onLeave: GateProps['onLeave']) {
  const props = { gate, x, onHover, onLeave };
  const name = gate.type.toUpperCase();

  if (name === 'CNOT' || name === 'CX') {
    if (gate.controls.length > 0) return <CNOTGate key={`${gate.layer}-${gate.targets[0]}`} {...props} />;
  }
  if (name === 'TOFFOLI' || name === 'CCX') {
    return <ToffoliGate key={`${gate.layer}-${gate.targets[0]}`} {...props} />;
  }
  if (name === 'SWAP') {
    return <SwapGate key={`${gate.layer}-${gate.targets[0]}`} {...props} />;
  }
  if (name === 'CZ') {
    return <CZGate key={`${gate.layer}-${gate.targets[0]}`} {...props} />;
  }
  if (name === 'MEASURE') {
    return <MeasureGate key={`${gate.layer}-${gate.targets[0]}`} {...props} />;
  }

  return <SingleQubitGate key={`${gate.layer}-${gate.targets[0]}`} {...props} />;
}
