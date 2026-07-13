import { useMemo } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecStore } from '../../stores/qecStore';
import { PanelHeader } from '../layout/PanelHeader';
import { QecEmptyState } from './QecEmptyState';
import { detectorGraphLayout, decodeOverlay } from './qecGeometry';
import { requestQecDecodeSample, requestQecSnapshot } from '../../lib/qecDecodeSender';

const DOCS = 'https://getnuclei.dev/docs/kernel-api/messages-qec/';

/**
 * PRD 10 Phase D — the detector graph. The panel that doesn't exist anywhere
 * else in a desktop tool: detector nodes (by coordinate or a deterministic
 * circle), probability-weighted edges, boundary edges to a virtual node, and a
 * "Sample a shot" overlay of the fired detectors + the decoder's matching.
 *
 * Honest states (PRD 10 constraint 6 + the dem_error/truncated contract):
 *  - `dem === null`  → a designed message with the kernel's `dem_error`.
 *  - `dem.truncated` → summary counts + "Render anyway" (re-request at a
 *    higher cap). Never a silently-missing graph.
 */
export function DetectorGraphPanel() {
  const colors = useThemeStore((s) => s.colors);
  const snapshot = useQecStore((s) => s.snapshot);
  const decodeSample = useQecStore((s) => s.decodeSample);
  const decodePending = useQecStore((s) => s.decodePending);
  const circuitText = useQecStore((s) => s.circuitText);

  const layout = useMemo(() => (snapshot ? detectorGraphLayout(snapshot) : null), [snapshot]);
  const overlay = useMemo(() => (decodeSample ? decodeOverlay(decodeSample) : null), [decodeSample]);

  const header = (
    <PanelHeader
      title="Detector Graph"
      context={snapshot ? `${snapshot.num_detectors} detectors` : undefined}
      helpHref={DOCS}
      actions={
        snapshot?.dem && circuitText ? (
          <button
            onClick={() => requestQecDecodeSample(circuitText)}
            disabled={decodePending}
            title="Sample one shot and decode it"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: colors.dirac, color: '#fff', border: 'none', borderRadius: 4,
              cursor: decodePending ? 'default' : 'pointer', fontSize: 11, padding: '4px 9px',
              opacity: decodePending ? 0.6 : 1, fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            {decodePending ? 'Sampling…' : 'Sample a shot'}
          </button>
        ) : undefined
      }
    />
  );

  if (!snapshot) return <div style={{ height: '100%', background: colors.bg }}>{header}</div>;

  // No detector error model at all (e.g. a non-deterministic observable).
  if (!snapshot.dem || !layout) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
        {header}
        <QecEmptyState
          title="No detector error model"
          body={snapshot.dem_error ?? 'stim could not build a detector error model for this circuit.'}
        />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
      {header}
      {snapshot.dem.truncated && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px',
            fontSize: 11, color: colors.warning, borderBottom: `1px solid ${colors.border}`,
            fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          <span>
            Graph truncated — {snapshot.dem.edge_count} edges + {snapshot.dem.boundary_edge_count}{' '}
            boundary exceed the render cap.
          </span>
          <button
            onClick={() => requestQecSnapshot(50_000)}
            style={{
              background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 4,
              color: colors.text, cursor: 'pointer', fontSize: 11, padding: '3px 8px',
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            Render anyway
          </button>
        </div>
      )}
      {snapshot.dem.hyperedges_count > 0 && (
        <div
          style={{
            padding: '5px 12px', fontSize: 10, color: colors.textDim,
            borderBottom: `1px solid ${colors.border}`, fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          Pairwise projection shown · {snapshot.dem.hyperedges_count} hyperedge(s) not drawn
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <DetectorGraphSvg layout={layout} overlay={overlay} />
      </div>
      {overlay && (
        <div
          aria-live="polite"
          style={{
            padding: '6px 12px', fontSize: 11, borderTop: `1px solid ${colors.border}`,
            color: overlay.logicalError ? colors.error : colors.success,
            fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          {overlay.firedDetectors.size} detector(s) fired · {overlay.matchedEdges.length} matched ·{' '}
          {overlay.logicalError ? 'logical error this shot' : 'corrected — no logical error'}
        </div>
      )}
    </div>
  );
}

function DetectorGraphSvg({
  layout,
  overlay,
}: {
  layout: ReturnType<typeof detectorGraphLayout>;
  overlay: ReturnType<typeof decodeOverlay> | null;
}) {
  const colors = useThemeStore((s) => s.colors);
  const W = 100;
  const H = 100;
  const px = (v: number) => v * W;
  const py = (v: number) => v * H;
  const nodePos = (d: number) =>
    d === -1 ? layout.boundary : (layout.nodes.find((n) => n.detector === d) ?? layout.boundary);

  const maxP = Math.max(...layout.edges.map((e) => e.p), 1e-9);
  const matchedKey = new Set(overlay?.matchedEdges.map((m) => `${Math.min(m.a, m.b)}:${Math.max(m.a, m.b)}`));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
      {/* edges */}
      {layout.edges.map((e, i) => {
        const a = nodePos(e.a);
        const b = nodePos(e.b);
        const isMatched = matchedKey.has(`${Math.min(e.a, e.b)}:${Math.max(e.a, e.b)}`);
        const weight = 0.3 + 1.4 * (e.p / maxP);
        return (
          <line
            key={i}
            x1={px(a.x)} y1={py(a.y)} x2={px(b.x)} y2={py(b.y)}
            stroke={isMatched ? colors.dirac : colors.border}
            strokeWidth={isMatched ? Math.max(weight, 1.2) : weight}
            strokeOpacity={isMatched ? 1 : 0.55}
          />
        );
      })}
      {/* virtual boundary node */}
      <rect
        x={px(layout.boundary.x) - 3} y={py(layout.boundary.y) - 1.6} width={6} height={3.2}
        rx={1} fill={colors.bgElevated} stroke={colors.textDim} strokeWidth={0.4}
      />
      {/* detector nodes */}
      {layout.nodes.map((n) => {
        const fired = overlay?.firedDetectors.has(n.detector) ?? false;
        return (
          <g key={n.detector}>
            <circle
              cx={px(n.x)} cy={py(n.y)} r={fired ? 2.6 : 1.8}
              fill={fired ? colors.error : colors.accent}
              stroke={colors.bg} strokeWidth={0.4}
            />
          </g>
        );
      })}
    </svg>
  );
}
