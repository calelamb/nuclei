import { Clock } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { useQecStore } from '../../stores/qecStore';
import { PanelHeader } from '../layout/PanelHeader';
import { QecEmptyState } from './QecEmptyState';
import {
  activeTimelineQubits, classifyTimelineGates, detectorTrackByTick, tickMomentCount, timelineLabel, type TimelineGate,
} from './qecGeometry';
import { subColumnCentre, timelineColumnLayout, type TimelineColumnLayout } from './qecTimelineLayout';
import { ScrollFade } from './ScrollFade';

import { TYPOGRAPHY } from '../../styles/tokens';
const DOCS = 'https://getnuclei.dev/docs/research/qec-studio/';
/** Narrowest a tick may be, and the width of each sub-column when a tick holds overlapping gates. */
const COL_W = 34;
const SUB_COL_W = 28;
const ROW_H = 26;
const LABEL_W = 36;
const PAD = 8;
/** Smallest text in the figure; below this the labels stop being readable. */
const FONT_PX = 10;
const GATE_W = 24;
const GATE_H = 18;
const TARGET_R = 7;
const CONTROL_R = 3;

/**
 * PRD 10 Phase D — the QEC timeline. The mapped stim CircuitSnapshot in
 * moment-mode (layer = tick), with two extensions over the plain circuit
 * diagram: noise ops rendered with a hazard tint (+ probability on hover),
 * and a DETECTOR/OBSERVABLE track along the bottom, aligned to ticks. Gates are
 * labelled with their Stim mnemonics, noise is an amber dot with the kind and
 * probability on hover, and qubits with no operations are not drawn.
 */
export function QecTimelinePanel({ embedded = false }: { embedded?: boolean } = {}) {
  const colors = useThemeStore((s) => s.colors);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const qec = useQecStore((s) => s.snapshot);
  const [hover, setHover] = useState<{ g: TimelineGate; x: number; y: number } | null>(null);

  const gates = useMemo(() => classifyTimelineGates(snapshot?.gates ?? []), [snapshot]);
  const track = useMemo(() => detectorTrackByTick(snapshot?.gates ?? []), [snapshot]);

  // Embedded in a workbench instrument card: the card header already carries the title, context and help.
  const header = embedded ? null : <PanelHeader title="Timeline" context={qec ? `${qec.num_ticks} ticks` : undefined} helpHref={DOCS} />;

  if (!snapshot || gates.length === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
        {header}
        <QecEmptyState icon={Clock} title="No circuit yet" body="Parse a Stim circuit to see its moment-by-moment timeline." docsHref={DOCS} />
      </div>
    );
  }

  const numTicks = tickMomentCount(qec?.num_ticks ?? 0, gates);
  const qubits = activeTimelineQubits(snapshot.gates);
  const rowOf = new Map(qubits.map((q, i) => [q, i]));
  const columns = timelineColumnLayout(gates, numTicks, rowOf, { subColumnPx: SUB_COL_W, minLayerPx: COL_W });
  const width = LABEL_W + columns.totalWidthPx + PAD * 2;
  const gateRows = qubits.length;
  const height = PAD * 2 + gateRows * ROW_H + 44; // + detector track

  const qy = (q: number) => PAD + (rowOf.get(q) ?? 0) * ROW_H + ROW_H / 2;
  /** Centre of a tick's band (detector track and gridline). */
  const tx = (t: number) => LABEL_W + (columns.layerStartPx[t] ?? 0) + (columns.layerWidthPx[t] ?? COL_W) / 2;
  /** Centre of one gate's sub-column inside its tick. */
  const gx = (g: TimelineGate) => LABEL_W + subColumnCentre(columns, g.layer, columns.subColumnOf.get(g.gateIndex) ?? 0, SUB_COL_W);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
      {header}
      <ScrollFade
        axis="x" label="Timeline, scrolls sideways" style={{ flex: 1, minHeight: 0, position: 'relative' }}
      >
        <svg width={width} height={height} style={{ display: 'block', margin: '0 auto', fontFamily: TYPOGRAPHY.fontMono }}>
          <TickBands columns={columns} labelW={LABEL_W} top={PAD} height={gateRows * ROW_H} fill={colors.border} />
          {/* qubit wires */}
          {qubits.map((q) => (
            <g key={`wire-${q}`}>
              <text x={PAD} y={qy(q) + 3.5} fontSize={FONT_PX} fill={colors.textMuted}>q{q}</text>
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
            const x = gx(g);
            if (g.isNoise) {
              return (
                <g key={g.gateIndex}
                  onMouseEnter={(e) => setHover({ g, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHover(null)}>
                  <circle cx={x + GATE_W / 2 - 1} cy={qy(q) - GATE_H / 2 + 1} r={3.5} fill={colors.warning} />
                </g>
              );
            }
            return <TimelineOp key={g.gateIndex} g={g} x={x} qy={qy} q={q} colors={colors} />;
          })}
          {/* detector/observable bottom track, aligned to ticks */}
          <text x={PAD} y={PAD + gateRows * ROW_H + 28} fontSize={FONT_PX} fill={colors.textMuted}>det</text>
          {[...track.entries()].map(([tick, markers]) => {
            const hasObs = markers.some((m) => m.isObservable);
            const detCount = markers.filter((m) => m.isDetector).length;
            const y = PAD + gateRows * ROW_H + 22;
            return (
              <g key={`det-${tick}`}>
                {detCount > 0 && (
                  <rect x={tx(tick) - 8} y={y} width={16} height={13} rx={2}
                    fill={`${colors.overlayMatching}44`} stroke={colors.overlayMatching} strokeWidth={0.6} />
                )}
                {detCount > 0 && (
                  <text x={tx(tick)} y={y + 10} fontSize={FONT_PX} fill={colors.overlayMatching} textAnchor="middle">{detCount}</text>
                )}
                {hasObs && <circle cx={tx(tick)} cy={y + 20} r={3} fill={colors.success} />}
              </g>
            );
          })}
        </svg>
        {hover && hover.g.probability !== null && (
          <div
            style={{
              position: 'fixed', left: hover.x + 12, top: hover.y + 12, zIndex: 2000,
              background: colors.bgElevated, border: `1px solid ${colors.border}`, borderRadius: 'var(--radius-soft)',
              padding: '5px 8px', fontSize: 11, color: colors.text, pointerEvents: 'none',
              fontFamily: TYPOGRAPHY.fontSans, boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}
          >
            {hover.g.noiseKind} · p = {hover.g.probability}
          </div>
        )}
      </ScrollFade>
      <div
        style={{
          display: 'flex', gap: 12, padding: '4px 12px', borderTop: `1px solid ${colors.border}`,
          fontSize: 11, color: colors.textMuted, fontFamily: TYPOGRAPHY.fontSans,
        }}
      >
        <span><span style={{ color: colors.warning }}>●</span> noise (hover)</span>
        <span><span style={{ color: colors.overlayMatching }}>■</span> detectors</span>
        <span><span style={{ color: colors.success }}>●</span> observable</span>
      </div>
    </div>
  );
}

interface TickBandsProps {
  columns: TimelineColumnLayout;
  labelW: number;
  top: number;
  height: number;
  fill: string;
}

/** A faint band behind every other tick, spanning all of its sub-columns, so parallel gates read as one moment. */
function TickBands({ columns, labelW, top, height, fill }: TickBandsProps) {
  return (
    <g aria-hidden="true">
      {columns.layerStartPx.map((start, tick) => tick % 2 === 0 && (
        <rect key={`band-${tick}`} x={labelW + start} y={top} width={columns.layerWidthPx[tick]} height={height} fill={fill} fillOpacity={0.25} />
      ))}
    </g>
  );
}

interface TimelineOpProps {
  g: TimelineGate;
  x: number;
  q: number;
  qy: (q: number) => number;
  colors: ReturnType<typeof useThemeStore.getState>['colors'];
}

/** One operation: a control dot joined to a target circle-plus for CNOT, a dot and box for other controlled gates, a box for the rest. */
function TimelineOp({ g, x, q, qy, colors }: TimelineOpProps) {
  const control = g.controls?.[0];
  const isTwoQ = control !== undefined && g.targets.length > 0;
  if (isTwoQ && g.type === 'CNOT') {
    const ty = qy(g.targets[0]);
    return (
      <g>
        <line x1={x} y1={qy(control)} x2={x} y2={ty} stroke={colors.text} strokeWidth={1} />
        <circle cx={x} cy={qy(control)} r={CONTROL_R} fill={colors.text} />
        <circle cx={x} cy={ty} r={TARGET_R} fill={colors.bgElevated} stroke={colors.accent} strokeWidth={1} />
        <path d={`M${x - TARGET_R} ${ty}H${x + TARGET_R}M${x} ${ty - TARGET_R}V${ty + TARGET_R}`} stroke={colors.accent} strokeWidth={1} />
        <title>CX {`q${control} to q${g.targets[0]}`}</title>
      </g>
    );
  }
  return (
    <g>
      {isTwoQ && <line x1={x} y1={qy(control)} x2={x} y2={qy(g.targets[0])} stroke={colors.text} strokeWidth={1} />}
      {isTwoQ && <circle cx={x} cy={qy(control)} r={CONTROL_R} fill={colors.text} />}
      <rect x={x - GATE_W / 2} y={qy(q) - GATE_H / 2} width={GATE_W} height={GATE_H} rx={2}
        fill={colors.bgElevated} stroke={colors.accent} strokeWidth={0.8}>
        <title>{g.type}</title>
      </rect>
      <text x={x} y={qy(q) + 3.5} fontSize={FONT_PX} fill={colors.text} textAnchor="middle">{timelineLabel(g.type)}</text>
    </g>
  );
}
