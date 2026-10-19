/**
 * Lab-styled circuit glyphs for the gradient heatmap (a fork of the
 * RunCircuitDiagram drawing approach built on Lab tokens instead of the
 * editor's hard-coded gate palette). Pure SVG; no store access.
 */

import type { CSSProperties } from 'react';
import type { Gate } from '../../types/quantum';
import { GLYPH_SIZE, gateX, wireY } from './glyphGeometry';

const STROKE: CSSProperties = { stroke: 'var(--color-text-secondary)', strokeWidth: 1.4, fill: 'none' };
const BOX: CSSProperties = { fill: 'var(--lab-surface-3)', stroke: 'var(--lab-axis)', strokeWidth: 1.2 };
const LABEL: CSSProperties = {
  fill: 'var(--color-text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10.5,
  fontVariantNumeric: 'tabular-nums',
};

function Box({ x, y, label }: { x: number; y: number; label: string }) {
  const short = label.length > 5 ? `${label.slice(0, 4)}…` : label;
  return (
    <g>
      <rect x={x - GLYPH_SIZE / 2} y={y - GLYPH_SIZE / 2} width={GLYPH_SIZE} height={GLYPH_SIZE} rx={5} style={BOX} />
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" style={LABEL}>
        {short}
      </text>
    </g>
  );
}

function Dot({ x, y }: { x: number; y: number }) {
  return <circle cx={x} cy={y} r={4} style={{ fill: 'var(--color-text-secondary)' }} />;
}

function Target({ x, y, type }: { x: number; y: number; type: string }) {
  const upper = type.toUpperCase();
  if (upper === 'CNOT' || upper === 'CX' || upper === 'TOFFOLI' || upper === 'CCX') {
    return (
      <g>
        <circle cx={x} cy={y} r={9} style={STROKE} />
        <line x1={x - 9} x2={x + 9} y1={y} y2={y} style={STROKE} />
        <line x1={x} x2={x} y1={y - 9} y2={y + 9} style={STROKE} />
      </g>
    );
  }
  if (upper === 'CZ') return <Dot x={x} y={y} />;
  if (upper === 'SWAP') {
    return (
      <g style={STROKE}>
        <line x1={x - 6} x2={x + 6} y1={y - 6} y2={y + 6} />
        <line x1={x - 6} x2={x + 6} y1={y + 6} y2={y - 6} />
      </g>
    );
  }
  return <Box x={x} y={y} label={type} />;
}

/** The base glyph for one gate; parameter tint is layered on by the caller. */
export function GateGlyph({ gate }: { gate: Gate }) {
  const x = gateX(gate.layer);
  const qubits = [...gate.controls, ...gate.targets];
  if (gate.type.toUpperCase().startsWith('MEASURE')) {
    return <Box x={x} y={wireY(gate.targets[0] ?? 0)} label="M" />;
  }
  if (qubits.length <= 1) {
    return <Box x={x} y={wireY(gate.targets[0] ?? 0)} label={gate.type} />;
  }
  const ys = qubits.map(wireY);
  return (
    <g>
      <line x1={x} x2={x} y1={Math.min(...ys)} y2={Math.max(...ys)} style={STROKE} />
      {gate.controls.map((q) => (
        <Dot key={`c${q}`} x={x} y={wireY(q)} />
      ))}
      {gate.targets.map((q) => (
        <Target key={`t${q}`} x={x} y={wireY(q)} type={gate.type} />
      ))}
    </g>
  );
}
