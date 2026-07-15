import { useCallback, useEffect, useMemo, useState } from 'react';
import { MousePointerClick } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecStore } from '../../stores/qecStore';
import { PanelHeader } from '../layout/PanelHeader';
import { QecEmptyState } from './QecEmptyState';
import { detectorGraphLayout, decodeOverlay, type DecodeOverlay } from './qecGeometry';
import { DetectorGraphCanvas } from './DetectorGraphCanvas';
import { buildDecodeInput, decodedToOverlay } from './qecDecoderInput';
import { decodeSyndrome, isDecoderAvailable } from '../../lib/qecDecoderWasm';
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
  const kernelOverlay = useMemo(() => (decodeSample ? decodeOverlay(decodeSample) : null), [decodeSample]);

  // Interactive in-webview decoding (WASM): toggle detectors and watch the
  // decoder re-solve instantly, with no kernel round-trip. Gated on the wasm
  // module loading; if it can't, the toggle simply never appears.
  const [decoderReady, setDecoderReady] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [syndrome, setSyndrome] = useState<Set<number>>(new Set());
  const [interactiveOverlay, setInteractiveOverlay] = useState<DecodeOverlay | null>(null);

  useEffect(() => {
    let alive = true;
    isDecoderAvailable().then((ok) => {
      if (alive) setDecoderReady(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Reset the interactive session whenever the circuit (layout) changes — the
  // React-recommended "adjust state during render" reset, so a new snapshot
  // never carries a stale syndrome (and no extra effect/commit).
  const [prevLayout, setPrevLayout] = useState(layout);
  if (layout !== prevLayout) {
    setPrevLayout(layout);
    setSyndrome(new Set());
    setInteractiveOverlay(null);
  }

  // Re-decode on every syndrome change while interactive. Only the async
  // result sets state (the display falls back to the kernel overlay whenever
  // `interactive` is off, so there's nothing to clear synchronously here).
  useEffect(() => {
    if (!interactive || !layout || !snapshot) return;
    let cancelled = false;
    const input = buildDecodeInput(layout, snapshot.num_detectors, snapshot.num_observables, syndrome);
    void decodeSyndrome(input).then((result) => {
      if (cancelled) return;
      setInteractiveOverlay(result ? decodedToOverlay(syndrome, result) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [interactive, layout, syndrome, snapshot]);

  const toggleDetector = useCallback((detector: number) => {
    setSyndrome((prev) => {
      const next = new Set(prev);
      if (next.has(detector)) next.delete(detector);
      else next.add(detector);
      return next;
    });
  }, []);

  const overlay = interactive ? interactiveOverlay : kernelOverlay;

  const header = (
    <PanelHeader
      title="Detector Graph"
      context={snapshot ? `${snapshot.num_detectors} detectors` : undefined}
      helpHref={DOCS}
      actions={
        snapshot?.dem ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {decoderReady && (
              <button
                onClick={() => setInteractive((v) => !v)}
                title="Toggle detectors and decode live in-app, no kernel round-trip"
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: interactive ? colors.accent : 'transparent',
                  color: interactive ? '#fff' : colors.text,
                  border: `1px solid ${interactive ? colors.accent : colors.border}`,
                  borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '4px 9px',
                  fontFamily: "'Geist Sans', sans-serif",
                }}
              >
                <MousePointerClick size={12} />
                Interactive
              </button>
            )}
            {circuitText && !interactive && (
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
            )}
          </div>
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
        <DetectorGraphCanvas
          layout={layout}
          overlay={overlay}
          onDetectorClick={interactive ? toggleDetector : undefined}
        />
      </div>
      {interactive ? (
        <div
          aria-live="polite"
          style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '6px 12px', fontSize: 11, borderTop: `1px solid ${colors.border}`,
            fontFamily: "'Geist Sans', sans-serif",
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: colors.textMuted }}>
            <MousePointerClick size={11} /> Click detectors to toggle the syndrome
          </span>
          {syndrome.size > 0 ? (
            <span style={{ color: interactiveOverlay?.logicalError ? colors.error : colors.success }}>
              · {syndrome.size} fired · {interactiveOverlay?.matchedEdges.length ?? 0} correction edge(s) ·{' '}
              {interactiveOverlay?.logicalError ? 'correction crosses a logical observable' : 'no logical error'}
            </span>
          ) : (
            <span style={{ color: colors.textDim }}>· syndrome empty</span>
          )}
          {syndrome.size > 0 && (
            <button
              onClick={() => setSyndrome(new Set())}
              style={{
                marginLeft: 'auto', background: 'transparent', border: `1px solid ${colors.border}`,
                borderRadius: 4, color: colors.textMuted, cursor: 'pointer', fontSize: 10, padding: '2px 7px',
                fontFamily: "'Geist Sans', sans-serif",
              }}
            >
              Clear
            </button>
          )}
        </div>
      ) : overlay ? (
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
      ) : null}
    </div>
  );
}

