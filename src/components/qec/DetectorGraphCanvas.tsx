import { useEffect, useMemo, useRef, useState } from 'react';
import { useThemeStore, type ThemeColors } from '../../stores/themeStore';
import {
  detectorNodeIndex,
  edgeHeatColor,
  type DetectorGraphLayout,
  type DecodeOverlay,
} from './qecGeometry';

interface DetectorGraphCanvasProps {
  layout: DetectorGraphLayout;
  overlay: DecodeOverlay | null;
}

interface HoverInfo {
  detector: number;
  cssX: number;
  cssY: number;
  wrapW: number;
  degree: number;
  fired: boolean;
}

const PAD = 16;

function edgeKey(a: number, b: number): string {
  return a <= b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Canvas detector-graph renderer. Replaces the old per-edge `<line>` SVG
 * (which reconciled up to 50k DOM nodes and did an O(edges·nodes) position
 * lookup). Canvas draws the whole graph in one pass, and adds real visual
 * encoding: edges are heat-colored + weighted by error probability (hotspots
 * glow), boundary edges are dashed, observable-flipping edges carry an accent,
 * and the decode overlay lights fired detectors + the matching. Hovering a
 * detector inspects it.
 */
export function DetectorGraphCanvas({ layout, overlay }: DetectorGraphCanvasProps) {
  const colors = useThemeStore((s) => s.colors);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  // Precomputed once per layout: O(1) node lookup + incident-edge degree.
  const nodeIndex = useMemo(() => detectorNodeIndex(layout), [layout]);
  const degree = useMemo(() => {
    const d = new Map<number, number>();
    for (const e of layout.edges) {
      d.set(e.a, (d.get(e.a) ?? 0) + 1);
      if (e.b !== -1) d.set(e.b, (d.get(e.b) ?? 0) + 1);
    }
    return d;
  }, [layout]);
  const maxP = useMemo(() => Math.max(...layout.edges.map((e) => e.p), 1e-9), [layout]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const draw = () => {
      const cssW = wrap.clientWidth;
      const cssH = wrap.clientHeight;
      if (cssW === 0 || cssH === 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const X = (nx: number) => PAD + nx * (cssW - 2 * PAD);
      const Y = (ny: number) => PAD + ny * (cssH - 2 * PAD);
      const matched = new Set(overlay?.matchedEdges.map((m) => edgeKey(m.a, m.b)));

      // Edges — sorted so higher-probability (hotter) edges draw on top.
      const ordered = [...layout.edges].sort((e1, e2) => e1.p - e2.p);
      ctx.lineCap = 'round';
      for (const e of ordered) {
        const a = nodeIndex.get(e.a);
        const b = nodeIndex.get(e.b);
        if (!a || !b) continue;
        const t = e.p / maxP;
        const isBoundary = e.a === -1 || e.b === -1;
        const isMatched = matched.has(edgeKey(e.a, e.b));
        const x1 = X(a.x);
        const y1 = Y(a.y);
        const x2 = X(b.x);
        const y2 = Y(b.y);

        if (isMatched) {
          ctx.strokeStyle = colors.dirac;
          ctx.lineWidth = 2.6;
          ctx.globalAlpha = 1;
          ctx.setLineDash([]);
        } else {
          const [r, g, bl] = edgeHeatColor(t);
          ctx.strokeStyle = `rgb(${r},${g},${bl})`;
          ctx.lineWidth = 0.6 + 2.4 * t;
          ctx.globalAlpha = isBoundary ? 0.5 : 0.7;
          ctx.setLineDash(isBoundary ? [3, 3] : []);
        }
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Observable-flipping edge: a thin bright accent overlay — these carry
        // logical information, so they should stand out from ordinary edges.
        if (!isMatched && e.obs.length > 0) {
          ctx.setLineDash([]);
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = colors.accentLight ?? colors.accent;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Virtual boundary node — a strip along the bottom.
      const bx = X(layout.boundary.x);
      const by = Y(layout.boundary.y);
      ctx.fillStyle = colors.bgElevated;
      ctx.strokeStyle = colors.textDim;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      const bw = 44;
      const bh = 10;
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(bx - bw / 2, by - bh / 2, bw, bh, 3);
      } else {
        ctx.rect(bx - bw / 2, by - bh / 2, bw, bh);
      }
      ctx.fill();
      ctx.stroke();

      // Detector nodes.
      for (const n of layout.nodes) {
        const cx = X(n.x);
        const cy = Y(n.y);
        const fired = overlay?.firedDetectors.has(n.detector) ?? false;
        if (fired) {
          ctx.beginPath();
          ctx.arc(cx, cy, 6, 0, Math.PI * 2);
          ctx.fillStyle = `${colors.error}44`;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(cx, cy, fired ? 3.4 : 2.1, 0, Math.PI * 2);
        ctx.fillStyle = fired ? colors.error : colors.accent;
        ctx.fill();
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = colors.bg;
        ctx.stroke();
      }

      // Hover ring.
      if (hover) {
        const n = layout.nodes.find((node) => node.detector === hover.detector);
        if (n) {
          ctx.beginPath();
          ctx.arc(X(n.x), Y(n.y), 6.5, 0, Math.PI * 2);
          ctx.strokeStyle = colors.text;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
    };

    draw();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [layout, overlay, colors, nodeIndex, maxP, hover]);

  const onMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const cssW = rect.width;
    const cssH = rect.height;
    const X = (nx: number) => PAD + nx * (cssW - 2 * PAD);
    const Y = (ny: number) => PAD + ny * (cssH - 2 * PAD);

    let best: HoverInfo | null = null;
    let bestDist = 11 * 11; // 11px hit radius, squared
    for (const n of layout.nodes) {
      const dx = X(n.x) - mx;
      const dy = Y(n.y) - my;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = {
          detector: n.detector,
          cssX: mx,
          cssY: my,
          wrapW: cssW,
          degree: degree.get(n.detector) ?? 0,
          fired: overlay?.firedDetectors.has(n.detector) ?? false,
        };
      }
    }
    setHover(best);
  };

  return (
    <div
      ref={wrapRef}
      style={{ position: 'absolute', inset: 0 }}
      onMouseLeave={() => setHover(null)}
    >
      <canvas
        ref={canvasRef}
        onMouseMove={onMove}
        style={{ display: 'block', width: '100%', height: '100%', cursor: hover ? 'pointer' : 'default' }}
      />

      <GraphLegend colors={colors} />

      {hover && (
        <div
          style={{
            position: 'absolute',
            left: Math.min(hover.cssX + 12, hover.wrapW - 150),
            top: Math.max(hover.cssY - 8, 4),
            pointerEvents: 'none',
            background: colors.bgElevated,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: '5px 9px',
            fontSize: 11,
            fontFamily: "'Geist Sans', sans-serif",
            color: colors.text,
            boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
            zIndex: 3,
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ fontWeight: 700 }}>
            Detector D{hover.detector}
            {hover.fired && <span style={{ color: colors.error, marginLeft: 6 }}>fired</span>}
          </div>
          <div style={{ color: colors.textMuted, fontFamily: "'Geist Mono', monospace", fontSize: 10 }}>
            {hover.degree} incident edge{hover.degree === 1 ? '' : 's'}
          </div>
        </div>
      )}
    </div>
  );
}

function GraphLegend({ colors }: { colors: ThemeColors }) {
  const [lo, mid, hi] = [edgeHeatColor(0), edgeHeatColor(0.5), edgeHeatColor(1)];
  const gradient = `linear-gradient(90deg, rgb(${lo.join(',')}), rgb(${mid.join(',')}), rgb(${hi.join(',')}))`;
  const row = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 9.5,
    color: colors.textDim,
    fontFamily: "'Geist Sans', sans-serif",
  } as const;

  return (
    <div
      style={{
        position: 'absolute',
        left: 10,
        bottom: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '7px 9px',
        background: `${colors.bg}cc`,
        border: `1px solid ${colors.border}`,
        borderRadius: 7,
        backdropFilter: 'blur(3px)',
        zIndex: 2,
        pointerEvents: 'none',
      }}
    >
      <div style={row}>
        <span style={{ width: 46, height: 6, borderRadius: 3, background: gradient }} />
        <span>error prob →</span>
      </div>
      <div style={row}>
        <span style={{ width: 14, height: 0, borderTop: `2px dashed ${colors.textDim}` }} />
        boundary
      </div>
      <div style={row}>
        <span style={{ width: 14, height: 0, borderTop: `2px solid ${colors.accentLight ?? colors.accent}` }} />
        observable
      </div>
      <div style={row}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: colors.error }} />
        fired
        <span style={{ width: 14, height: 0, borderTop: `2px solid ${colors.dirac}`, marginLeft: 6 }} />
        matched
      </div>
    </div>
  );
}
