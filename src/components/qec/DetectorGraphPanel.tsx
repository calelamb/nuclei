import { useMemo } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecStore } from '../../stores/qecStore';
import { PanelHeader } from '../layout/PanelHeader';
import { QecEmptyState } from './QecEmptyState';
import { detectorGraphLayout, decodeOverlay } from './qecGeometry';
import { DetectorGraphCanvas } from './DetectorGraphCanvas';
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
          docsHref={DOCS}
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
        <DetectorGraphCanvas layout={layout} overlay={overlay} />
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

