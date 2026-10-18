/**
 * Tidy-tree layout of a run's lineage (root = seed). Pure, so the component
 * memoizes it by structure and stays smooth at ~500 nodes. The tree grows
 * left to right: x = generation depth, y = tidy sibling order.
 */

import { hierarchy, tree } from 'd3';
import type { CandidateRecord } from '../../types/discovery';
import { numericId } from './candidateView';

const LINEAGE_COL = 64;
const LINEAGE_ROW = 22;
const VIRTUAL_ROOT = '__lineage_root__';

interface LineageNode {
  id: string;
  parentId: string | null;
  x: number;
  y: number;
  depth: number;
}

interface LineageLink {
  source: string;
  target: string;
}

export interface LineageLayout {
  nodes: LineageNode[];
  links: LineageLink[];
  byId: Map<string, LineageNode>;
  width: number;
  height: number;
  /** Children per node id in drawing order, for keyboard navigation. */
  children: Map<string, string[]>;
}

interface TreeDatum {
  id: string;
  children: TreeDatum[];
}

/** Cheap structural signature; the layout depends on nothing else. */
export function lineageSignature(candidates: readonly CandidateRecord[]): string {
  return candidates.map((c) => `${c.id}<${c.parent_id ?? ''}`).join('|');
}

export function buildLineageLayout(candidates: readonly CandidateRecord[]): LineageLayout {
  const ids = new Set(candidates.map((c) => c.id));
  const kids = new Map<string, string[]>();
  const roots: string[] = [];
  for (const c of [...candidates].sort((a, b) => numericId(a.id) - numericId(b.id))) {
    if (c.parent_id && ids.has(c.parent_id) && c.parent_id !== c.id) {
      kids.set(c.parent_id, [...(kids.get(c.parent_id) ?? []), c.id]);
    } else {
      roots.push(c.id);
    }
  }
  const datum = (id: string, seen: Set<string>): TreeDatum => {
    seen.add(id);
    return { id, children: (kids.get(id) ?? []).filter((k) => !seen.has(k)).map((k) => datum(k, seen)) };
  };
  const seen = new Set<string>();
  const rootDatum: TreeDatum =
    roots.length === 1
      ? datum(roots[0], seen)
      : { id: VIRTUAL_ROOT, children: roots.map((r) => datum(r, seen)) };

  const root = hierarchy<TreeDatum>(rootDatum);
  tree<TreeDatum>().nodeSize([LINEAGE_ROW, LINEAGE_COL])(root);

  const nodes: LineageNode[] = [];
  const links: LineageLink[] = [];
  const children = new Map<string, string[]>();
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxX = 0;
  root.each((n) => {
    if (n.data.id === VIRTUAL_ROOT) return;
    const parentId = n.parent && n.parent.data.id !== VIRTUAL_ROOT ? n.parent.data.id : null;
    const depth = n.depth - (roots.length === 1 ? 0 : 1);
    const node: LineageNode = { id: n.data.id, parentId, x: depth * LINEAGE_COL, y: n.x ?? 0, depth };
    nodes.push(node);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
    maxX = Math.max(maxX, node.x);
    if (parentId) links.push({ source: parentId, target: node.id });
    children.set(node.id, (n.children ?? []).map((k) => k.data.id));
  });
  const offset = Number.isFinite(minY) ? -minY : 0;
  const shifted = nodes.map((n) => ({ ...n, y: n.y + offset }));
  return {
    nodes: shifted,
    links,
    byId: new Map(shifted.map((n) => [n.id, n])),
    width: maxX,
    height: Number.isFinite(maxY) ? maxY + offset : 0,
    children,
  };
}

export type LineageKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/** Keyboard navigation: left = parent, right = first child, up/down = adjacent sibling. */
export function lineageNeighbor(layout: LineageLayout, id: string, key: LineageKey): string | null {
  const node = layout.byId.get(id);
  if (!node) return null;
  if (key === 'ArrowLeft') return node.parentId;
  if (key === 'ArrowRight') return layout.children.get(id)?.[0] ?? null;
  const siblings = node.parentId ? (layout.children.get(node.parentId) ?? []) : layout.nodes.filter((n) => !n.parentId).map((n) => n.id);
  const at = siblings.indexOf(id);
  if (at < 0) return null;
  return siblings[at + (key === 'ArrowDown' ? 1 : -1)] ?? null;
}
