import { useMemo, useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { useQecStore } from '../../stores/qecStore';
import { PanelHeader } from '../layout/PanelHeader';
import { QecEmptyState } from './QecEmptyState';
import { classifyTimelineGates, detectorTrackByTick, type TimelineGate } from './qecGeometry';

const DOCS = 'https://getnuclei.dev/docs/research/qec-studio/';
const COL_W = 26;
const ROW_H = 22;
const LABEL_W = 34;
const PAD = 8;

/**
 * PRD 10 Phase D — the QEC timeline. The mapped stim CircuitSnapshot in
 * moment-mode (layer = tick), with two extensions over the plain circuit
 * diagram: noise ops rendered with a hazard tint (+ probability on hover),
 * and a DETECTOR/OBSERVABLE track along the bottom, aligned to ticks.
 */
export function QecTimelinePanel() {
  const colors = useThemeStore((s) => s.colors);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const qec = useQecStore((s) => s.snapshot);
  const [hover, setHover] = useState<{ g: TimelineGate; x: number; y: number } | null>(null);

  const gates = useMemo(() => classifyTimelineGates(snapshot?.gates ?? []), [snapshot]);
  const track = useMemo(() => detectorTrackByTick(snapshot?.gates ?? []), [snapshot]);

  const header = <PanelHeader title="Timeline" context={qec ? `${qec.num_ticks} ticks` : undefined} helpHref={DOCS} />;

  if (!snapshot || gates.length === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
        {header}
        <QecEmptyState title="No circuit yet" body="Parse a Stim circuit to see its moment-by-moment timeline." docsHref={DOCS} />
      </div>
    );
  }

  const numTicks = Math.max(1, qec?.num_ticks ?? Math.max(...gates.map((g) => g.layer + 1)));
  const numQubits = snapshot.qubit_count;
  const width = LABEL_W + numTicks * COL_W + PAD * 2;
  const gateRows = numQubits;
  const height = PAD * 2 + gateRows * ROW_H + 44; // + detector track

  const qy = (q: number) => PAD + q * ROW_H + ROW_H / 2;
  const tx = (t: number) => LABEL_W + t * COL_W + COL_W / 2;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
      {header}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}>
        <svg width={width} height={height} style={{ display: 'block', fontFamily: "'Fira Code', monospace" }}>
          {/* qubit wires */}
          {Array.from({ length: numQubits }, (_, q) => (
            <g key={`wire-${q}`}>
              <text x={PAD} y={qy(q) + 3} fontSize={9} fill={colors.textDim}>q{q}</text>
              <line x1={LABEL_W} y1={qy(q)} x2={width - PAD} y2={qy(q)} stroke={colors.border} strokeWidth={0.5} />
            </g>
          ))}
          {/* tick gridlines */}
          {Array.from({ length: numTicks }, (_, t) => (
            <line key={`grid-${t}`} x1={tx(t)} y1={PAD} x2={tx(t)} y2={PAD + gateRows * ROW_H}
              stroke={colors.border} strokeWidth={0.3} strokeOpacity={0.4} />
          ))}
          {/* gates */}
          {gates.map((g) => {
            if (g.isDetector || g.isObservable) return null;
            const q = g.targets[0] ?? g.controls?.[0] ?? 0;
            const x = tx(g.layer);
            if (g.isNoise) {
              return (
                <g key={g.gateIndex}
                  onMouseEnter={(e) => setHover({ g, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHover(null)}>
                  <rect x={x - 9} y={qy(q) - 8} width={18} height={16} rx={2}
                    fill={`${colors.warning}33`} stroke={colors.warning} strokeWidth={0.6} strokeDasharray="2 1.5" />
                  <text x={x} y={qy(q) + 3} fontSize={7} fill={colors.warning} textAnchor="middle">{g.noiseKind?.slice(0, 4)}</text>
                </g>
              );
            }
            // Two-qubit gate: draw a vertical connector.
            const isTwoQ = (g.controls?.length ?? 0) > 0 && g.targets.length > 0;
            return (
              <g key={g.gateIndex}>
                {isTwoQ && (
                  <line x1={x} y1={qy(g.controls![0])} x2={x} y2={qy(g.targets[0])} stroke={colors.text} strokeWidth={0.8} />
                )}
                {isTwoQ && <circle cx={x} cy={qy(g.controls![0])} r={1.8} fill={colors.text} />}
                <rect x={x - 8} y={qy(q) - 8} width={16} height={16} rx={2}
                  fill={colors.bgElevated} stroke={colors.accent} strokeWidth={0.7} />
                <text x={x} y={qy(q) + 3} fontSize={7.5} fill={colors.text} textAnchor="middle">
                  {g.type === 'CNOT' ? 'X' : g.type.slice(0, 3)}
                </text>
              </g>
            );
          })}
          {/* detector/observable bottom track, aligned to ticks */}
          <text x={PAD} y={PAD + gateRows * ROW_H + 26} fontSize={8} fill={colors.textDim}>det</text>
          {[...track.entries()].map(([tick, markers]) => {
            const hasObs = markers.some((m) => m.isObservable);
            const detCount = markers.filter((m) => m.isDetector).length;
            const y = PAD + gateRows * ROW_H + 22;
            return (
              <g key={`det-${tick}`}>
                {detCount > 0 && (
                  <rect x={tx(tick) - 6} y={y} width={12} height={8} rx={1.5}
                    fill={`${colors.dirac}44`} stroke={colors.dirac} strokeWidth={0.5} />
                )}
                {detCount > 0 && (
                  <text x={tx(tick)} y={y + 6} fontSize={6.5} fill={colors.dirac} textAnchor="middle">{detCount}</text>
                )}
                {hasObs && <circle cx={tx(tick)} cy={y + 14} r={2} fill={colors.success} />}
              </g>
            );
          })}
        </svg>
        {hover && hover.g.probability !== null && (
          <div
            style={{
              position: 'fixed', left: hover.x + 12, top: hover.y + 12, zIndex: 2000,
              background: colors.bgElevated, border: `1px solid ${colors.border}`, borderRadius: 6,
              padding: '5px 8px', fontSize: 10, color: colors.text, pointerEvents: 'none',
              fontFamily: "'Geist Sans', sans-serif", boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}
          >
            {hover.g.noiseKind} · p = {hover.g.probability}
          </div>
        )}
      </div>
    </div>
  );
}
