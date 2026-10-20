/**
 * Column packing for the QEC timeline.
 *
 * A tick (layer) usually holds several gates that touch overlapping wire
 * spans, for example six parallel CNOTs. Drawn in one column their
 * connectors fuse into a single line, so each layer is split into
 * sub-columns by greedy interval packing: a gate goes into the first
 * sub-column whose already-placed gates do not share a wire row with it
 * (the same approach as Stim's timeline-svg).
 */

export interface TimelinePackGate {
  readonly gateIndex: number;
  readonly layer: number;
  readonly controls?: readonly number[];
  readonly targets: readonly number[];
  readonly isNoise: boolean;
  readonly isDetector: boolean;
  readonly isObservable: boolean;
}

export interface TimelineColumnLayout {
  /** Sub-column of each packed gate inside its layer, keyed by gateIndex. */
  readonly subColumnOf: ReadonlyMap<number, number>;
  /** Sub-column count per layer (at least 1). */
  readonly subCounts: readonly number[];
  /** Left edge of each layer in px, relative to the first layer. */
  readonly layerStartPx: readonly number[];
  readonly layerWidthPx: readonly number[];
  readonly totalWidthPx: number;
}

interface Span { readonly lo: number; readonly hi: number }

function rowSpan(gate: TimelinePackGate, rowOf: ReadonlyMap<number, number>): Span | null {
  const rows = [...(gate.controls ?? []), ...gate.targets]
    .map((q) => rowOf.get(q))
    .filter((r): r is number => r !== undefined);
  if (rows.length === 0) return null;
  return { lo: Math.min(...rows), hi: Math.max(...rows) };
}

function overlaps(a: Span, b: Span): boolean {
  return a.lo <= b.hi && b.lo <= a.hi;
}

/** Assign each gate of one layer to a sub-column; returns the sub-column per gate and the column count. */
function packLayer(
  gates: readonly TimelinePackGate[],
  rowOf: ReadonlyMap<number, number>,
): { readonly placed: ReadonlyMap<number, number>; readonly count: number } {
  const columns: Span[][] = [];
  const placed = new Map<number, number>();
  for (const gate of gates) {
    const span = rowSpan(gate, rowOf);
    if (!span) continue;
    let index = columns.findIndex((spans) => spans.every((s) => !overlaps(s, span)));
    if (index === -1) {
      columns.push([]);
      index = columns.length - 1;
    }
    columns[index].push(span);
    placed.set(gate.gateIndex, index);
  }
  return { placed, count: Math.max(1, columns.length) };
}

export function timelineColumnLayout(
  gates: readonly TimelinePackGate[],
  numLayers: number,
  rowOf: ReadonlyMap<number, number>,
  options: { readonly subColumnPx: number; readonly minLayerPx: number },
): TimelineColumnLayout {
  const byLayer: TimelinePackGate[][] = Array.from({ length: numLayers }, () => []);
  for (const gate of gates) {
    if (gate.isNoise || gate.isDetector || gate.isObservable) continue;
    byLayer[gate.layer]?.push(gate);
  }
  const subColumnOf = new Map<number, number>();
  const subCounts: number[] = [];
  const layerStartPx: number[] = [];
  const layerWidthPx: number[] = [];
  let cursor = 0;
  for (const layerGates of byLayer) {
    const { placed, count } = packLayer(layerGates, rowOf);
    placed.forEach((sub, id) => subColumnOf.set(id, sub));
    const width = Math.max(options.minLayerPx, count * options.subColumnPx);
    subCounts.push(count);
    layerStartPx.push(cursor);
    layerWidthPx.push(width);
    cursor += width;
  }
  return { subColumnOf, subCounts, layerStartPx, layerWidthPx, totalWidthPx: cursor };
}

/** Horizontal centre of a gate's sub-column, relative to the first layer. */
export function subColumnCentre(
  layout: TimelineColumnLayout,
  layer: number,
  sub: number,
  subColumnPx: number,
): number {
  const count = layout.subCounts[layer] ?? 1;
  const inset = (layout.layerWidthPx[layer] - count * subColumnPx) / 2;
  return layout.layerStartPx[layer] + inset + (sub + 0.5) * subColumnPx;
}
