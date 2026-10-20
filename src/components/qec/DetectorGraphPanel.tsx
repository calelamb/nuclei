import { useCallback, useEffect, useMemo, useState } from 'react';
import { MousePointerClick, Network } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecStore } from '../../stores/qecStore';
import { Button } from '../ui/Button';
import './qecAnalysis.css';
import { PanelHeader } from '../layout/PanelHeader';
import { QecEmptyState } from './QecEmptyState';
import { CircuitExplainPanel } from './CircuitExplainPanel';
import { detectorGraphLayout, decodeOverlay, type DecodeOverlay } from './qecGeometry';
import { DetectorGraphCanvas } from './DetectorGraphCanvas';
import { buildDecodeInput, decodedToOverlay } from './qecDecoderInput';
import { decodeSyndrome, isDecoderAvailable } from '../../lib/qecDecoderWasm';
import { parseDemGraphWasm, type DemDetectorGraph } from '../../lib/qecDemWasm';
import { requestQecDecodeSample, requestQecSnapshot } from '../../lib/qecDecodeSender';

import { ICON_SIZE, ICON_STROKE, TYPOGRAPHY } from '../../styles/tokens';
const DOCS = 'https://getnuclei.dev/docs/kernel-api/messages-qec/';
/** The graph never collapses below this; the panel scrolls instead. */
const GRAPH_MIN_HEIGHT = 280;

/** The in-app interactive decoder is the WASM greedy matcher, not PyMatching. */
export const INTERACTIVE_DECODER_LABEL = 'preview: greedy matcher, not PyMatching';

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
export function DetectorGraphPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const colors = useThemeStore((s) => s.colors);
  const snapshot = useQecStore((s) => s.snapshot);
  const decodeSample = useQecStore((s) => s.decodeSample);
  const decodePending = useQecStore((s) => s.decodePending);
  const circuitText = useQecStore((s) => s.circuitText);

  // Client-side full render (WASM): when the kernel truncates the graph it
  // forwards the DEM text; parsing it here renders the whole graph with no
  // kernel edge cap. `clientDem` holds the parsed result once requested.
  const [clientDem, setClientDem] = useState<DemDetectorGraph | null>(null);
  const [clientRendering, setClientRendering] = useState(false);

  // Drop the client render whenever a fresh snapshot arrives.
  const [prevSnapshot, setPrevSnapshot] = useState(snapshot);
  if (snapshot !== prevSnapshot) {
    setPrevSnapshot(snapshot);
    setClientDem(null);
  }

  const effectiveSnapshot = useMemo(() => {
    if (!snapshot) return null;
    if (!clientDem) return snapshot;
    return { ...snapshot, dem: { nodes: snapshot.num_detectors, ...clientDem } };
  }, [snapshot, clientDem]);

  const layout = useMemo(
    () => (effectiveSnapshot ? detectorGraphLayout(effectiveSnapshot) : null),
    [effectiveSnapshot],
  );
  const kernelOverlay = useMemo(() => (decodeSample ? decodeOverlay(decodeSample) : null), [decodeSample]);

  const renderFullGraph = useCallback(async () => {
    if (!snapshot?.dem_text) {
      requestQecSnapshot(50_000);
      return;
    }
    setClientRendering(true);
    const parsed = await parseDemGraphWasm(snapshot.dem_text, 5_000_000);
    setClientRendering(false);
    if (parsed) setClientDem(parsed);
    else requestQecSnapshot(50_000); // wasm unavailable → kernel path at the cap
  }, [snapshot]);

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

  const header = embedded ? null : (
    <PanelHeader
      title="Detector Graph"
      context={snapshot ? `${snapshot.num_detectors} detectors` : undefined}
      helpHref={DOCS}
    />
  );

  // Controls sit in their own wrapping row so a narrow rail never squeezes the title.
  const toolbar = snapshot?.dem ? (
    <div
      style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '6px 12px',
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      {decoderReady && (
        <Button
          size="sm"
          aria-pressed={interactive}
          variant="secondary"
          className="qec-toggle-btn"
          onClick={() => setInteractive((v) => !v)}
          title="Toggle detectors and decode live in-app, no kernel round-trip"
          icon={<MousePointerClick size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}
        >
          Interactive
        </Button>
      )}
      {circuitText && !interactive && (
        <Button
          variant="primary"
          size="sm"
          onClick={() => requestQecDecodeSample(circuitText)}
          disabled={decodePending}
          title="Sample one shot and decode it"
        >
          {decodePending ? 'Sampling…' : 'Sample a shot'}
        </Button>
      )}
    </div>
  ) : null;

  if (!snapshot) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
        {header}
        <div style={{ flex: 1 }} />
        <CircuitExplainPanel />
      </div>
    );
  }

  // No detector error model at all (e.g. a non-deterministic observable).
  if (!snapshot.dem || !layout) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
        {header}
        <QecEmptyState
          icon={Network}
          title="No detector error model"
          body={snapshot.dem_error ?? 'stim could not build a detector error model for this circuit.'}
          docsHref={DOCS}
        />
        <CircuitExplainPanel />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg, overflowY: 'auto' }}>
      {header}
      {toolbar}
      {snapshot.dem.truncated && !clientDem && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px',
            fontSize: 11, color: colors.warning, borderBottom: `1px solid ${colors.border}`,
            fontFamily: TYPOGRAPHY.fontSans,
          }}
        >
          <span>
            Graph truncated — {snapshot.dem.edge_count} edges + {snapshot.dem.boundary_edge_count}{' '}
            boundary exceed the render cap.
          </span>
          <Button
            size="sm"
            onClick={() => void renderFullGraph()}
            loading={clientRendering}
            title="Parse and render the whole graph in-app (WASM) — no kernel edge cap"
          >
            {clientRendering ? 'Rendering…' : 'Render full graph'}
          </Button>
        </div>
      )}
      {clientDem && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px',
            fontSize: 11, color: colors.accentText, borderBottom: `1px solid ${colors.border}`,
            fontFamily: TYPOGRAPHY.fontSans,
          }}
        >
          Full graph rendered in-app · {clientDem.edge_count} edges + {clientDem.boundary_edge_count} boundary
          {clientDem.hyperedges_count > 0 ? ` · ${clientDem.hyperedges_count} hyperedge(s) not drawn` : ''}
        </div>
      )}
      {snapshot.dem.hyperedges_count > 0 && (
        <div
          style={{
            padding: '5px 12px', fontSize: 11, color: colors.textDim,
            borderBottom: `1px solid ${colors.border}`, fontFamily: TYPOGRAPHY.fontSans,
          }}
        >
          Pairwise projection shown · {snapshot.dem.hyperedges_count} hyperedge(s) not drawn
        </div>
      )}
      <div style={{ flex: 1, minHeight: GRAPH_MIN_HEIGHT, position: 'relative' }}>
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
            fontFamily: TYPOGRAPHY.fontSans,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: colors.textMuted }}>
            <MousePointerClick size={ICON_SIZE.xs} /> Click detectors to toggle the syndrome
          </span>
          <span
            data-testid="interactive-decoder-label"
            title={INTERACTIVE_DECODER_LABEL}
            aria-label={INTERACTIVE_DECODER_LABEL}
            style={{
              fontSize: 11, color: colors.warning, border: `1px solid ${colors.warning}`,
              borderRadius: 'var(--radius-xs)', padding: '0 var(--space-1)', whiteSpace: 'nowrap',
            }}
          >
            Greedy preview
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
            <Button size="sm" onClick={() => setSyndrome(new Set())} style={{ marginLeft: 'auto' }}>Clear</Button>
          )}
        </div>
      ) : overlay ? (
        <div
          aria-live="polite"
          style={{
            padding: '6px 12px', fontSize: 11, borderTop: `1px solid ${colors.border}`,
            color: overlay.logicalError ? colors.error : colors.success,
            fontFamily: TYPOGRAPHY.fontSans,
          }}
        >
          {overlay.firedDetectors.size} detector(s) fired · {overlay.matchedEdges.length} matched ·{' '}
          {overlay.logicalError ? 'logical error this shot' : 'corrected — no logical error'}
        </div>
      ) : null}
      <CircuitExplainPanel />
    </div>
  );
}
