import { describe, expect, it } from 'vitest';
import { fixtureCandidates, fixtureRun } from './fixtures';
import { candidateKind, fitnessExtent, indexById, isImprovement, normalizeFitness } from './candidateView';
import { buildTrajectory, stepPath, trajectorySummary } from './trajectory';
import { buildLineageLayout, isMoreNode, LINEAGE_MAX_LEAF_SIBLINGS, LINEAGE_ROW, lineageNeighbor, lineageSignature } from './lineageLayout';
import { DEFAULT_FILTER, filterCandidates, sortCandidates } from './candidateTable';
import { RED_QUEEN_EXPLAINER, SANDBOX_HONESTY } from './honesty';
import { guardrailPassRates, isolationNote, isolationUsed, rejectionReasons } from './guardrailStats';

const candidates = fixtureCandidates();

describe('candidateView', () => {
  it('classifies every outcome', () => {
    const kinds = Object.fromEntries(candidates.map((c) => [c.id, candidateKind(c)]));
    expect(kinds).toMatchObject({
      'c-0000': 'seed', 'c-0001': 'scored', 'c-0004': 'rejected', 'c-0005': 'failed',
      'c-0006': 'screened_out', 'c-0007': 'duplicate', 'c-0008': 'invalid',
    });
  });

  it('flags improvements over a scored parent only', () => {
    const byId = indexById(candidates);
    expect(isImprovement(byId.get('c-0001')!, byId)).toBe(true);
    expect(isImprovement(byId.get('c-0000')!, byId)).toBe(false);
    expect(isImprovement(byId.get('c-0004')!, byId)).toBe(false);
  });

  it('normalizes fitness into the scored range', () => {
    const extent = fitnessExtent(candidates);
    expect(extent).toEqual([1, 2.9]);
    expect(normalizeFitness(1, extent)).toBe(0);
    expect(normalizeFitness(2.9, extent)).toBe(1);
    expect(normalizeFitness(5, null)).toBe(0.5);
  });
});

describe('buildTrajectory', () => {
  const t = buildTrajectory(candidates);
  it('puts rejected and failed candidates on the baseline lane below every fitness', () => {
    const lane = t.points.filter((p) => p.kind === 'rejected' || p.kind === 'failed');
    expect(lane.map((p) => p.id)).toEqual(['c-0004', 'c-0005', 'c-0010']);
    expect(lane.every((p) => p.y === t.laneY && p.y < t.yMin)).toBe(true);
  });
  it('keeps a monotone best-so-far per island', () => {
    expect(t.islands.map((s) => s.island)).toEqual([0, 1]);
    for (const s of t.islands) {
      const bests = s.steps.map((x) => x.best);
      expect(bests).toEqual([...bests].sort((a, b) => a - b));
    }
    expect(t.islands[0].steps.at(-1)?.best).toBe(2.9);
  });
  it('plots screened-out candidates at their screen fitness and skips duplicates and invalid ones', () => {
    expect(t.points.find((p) => p.id === 'c-0006')).toMatchObject({ kind: 'screened_out', y: 0.6 });
    expect(t.points.some((p) => p.id === 'c-0007' || p.id === 'c-0008')).toBe(false);
    expect(t.unplotted).toBe(2);
  });
  it('handles an empty run and builds a step path and a summary', () => {
    const empty = buildTrajectory([]);
    expect(empty.points).toEqual([]);
    expect(empty.yMax).toBeGreaterThan(empty.yMin);
    expect(stepPath([{ index: 1, best: 2 }, { index: 4, best: 3 }], 10, (v) => v, (v) => -v)).toBe('M1,-2H4V-3H10');
    expect(trajectorySummary(t)).toMatch(/4 scored, 1 rejected|scored/);
  });
});

describe('buildLineageLayout', () => {
  const layout = buildLineageLayout(candidates);
  it('roots the tree at the seed and places children one column right of their parent', () => {
    const root = layout.byId.get('c-0000')!;
    expect(root.depth).toBe(0);
    expect(layout.byId.get('c-0001')!.x).toBeGreaterThan(root.x);
    expect(layout.links).toContainEqual({ source: 'c-0001', target: 'c-0003' });
    expect(layout.nodes).toHaveLength(candidates.length);
  });
  it('never overlaps nodes in the same column', () => {
    const seen = new Set<string>();
    for (const n of layout.nodes) {
      const key = `${n.x}:${n.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
  it('navigates with arrow keys', () => {
    expect(lineageNeighbor(layout, 'c-0001', 'ArrowLeft')).toBe('c-0000');
    expect(lineageNeighbor(layout, 'c-0001', 'ArrowRight')).toBe('c-0003');
    expect(lineageNeighbor(layout, 'c-0001', 'ArrowDown')).toBe('c-0002');
    expect(lineageNeighbor(layout, 'c-0002', 'ArrowUp')).toBe('c-0001');
    expect(lineageNeighbor(layout, 'c-0000', 'ArrowLeft')).toBeNull();
  });
  it('survives orphans and lays out 600 nodes quickly', () => {
    const orphan = { ...candidates[1], id: 'c-0099', parent_id: 'c-9999' };
    expect(buildLineageLayout([...candidates, orphan]).nodes).toHaveLength(candidates.length + 1);
    const many = Array.from({ length: 600 }, (_, i) => ({ ...candidates[1], id: `c-${String(i).padStart(4, '0')}`, parent_id: i === 0 ? null : `c-${String(Math.floor((i - 1) / 2)).padStart(4, '0')}` }));
    const started = performance.now();
    expect(buildLineageLayout(many).nodes).toHaveLength(600);
    expect(performance.now() - started).toBeLessThan(500);
  });
  it('signature changes with structure only', () => {
    expect(lineageSignature(candidates)).toBe(lineageSignature(candidates.map((c) => ({ ...c, program: 'x' }))));
    expect(lineageSignature(candidates)).not.toBe(lineageSignature(candidates.slice(1)));
  });
});

describe('buildLineageLayout star-shaped trees', () => {
  const base = candidates[1];
  const id = (i: number) => `c-${String(i).padStart(4, '0')}`;
  const star = (n: number) => [
    { ...candidates[0], id: id(0), parent_id: null },
    ...Array.from({ length: n }, (_, i) => ({ ...base, id: id(i + 1), parent_id: id(0) })),
  ];
  const minGap = (ys: number[]) => ys.sort((a, b) => a - b).reduce((m, y, i, a) => (i === 0 ? m : Math.min(m, y - a[i - 1])), Infinity);

  it('collapses 60 leaf children into K nodes plus one "+N more" node', () => {
    const layout = buildLineageLayout(star(60));
    expect(layout.nodes).toHaveLength(1 + LINEAGE_MAX_LEAF_SIBLINGS + 1);
    const more = layout.nodes.find((n) => isMoreNode(n.id))!;
    expect(more.collapsed?.ids).toHaveLength(60 - LINEAGE_MAX_LEAF_SIBLINGS);
    expect(more.parentId).toBe(id(0));
  });
  it('keeps a minimum sibling spacing and never overlaps nodes, collapsed or expanded', () => {
    for (const layout of [buildLineageLayout(star(60)), buildLineageLayout(star(60), { expanded: new Set([id(0)]) })]) {
      const column = layout.nodes.filter((n) => n.depth === 1).map((n) => n.y);
      expect(minGap(column)).toBeGreaterThanOrEqual(LINEAGE_ROW);
      for (const a of layout.nodes) {
        for (const b of layout.nodes) {
          if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(LINEAGE_ROW);
        }
      }
    }
    expect(buildLineageLayout(star(60), { expanded: new Set([id(0)]) }).nodes).toHaveLength(61);
  });
  it('never hides a child that has descendants of its own', () => {
    const list = [...star(40), { ...base, id: id(99), parent_id: id(40) }];
    const layout = buildLineageLayout(list);
    expect(layout.byId.has(id(40))).toBe(true);
    expect(layout.byId.has(id(99))).toBe(true);
  });
  it('lays out a 500-node star quickly', () => {
    const started = performance.now();
    buildLineageLayout(star(499));
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('candidate table', () => {
  it('filters by status, mutator, island and id text', () => {
    expect(filterCandidates(candidates, { ...DEFAULT_FILTER, status: 'rejected' }).map((c) => c.id)).toEqual(['c-0004', 'c-0010']);
    expect(filterCandidates(candidates, { ...DEFAULT_FILTER, mutator: 'ast' })).toHaveLength(4);
    expect(filterCandidates(candidates, { ...DEFAULT_FILTER, island: '1' }).every((c) => c.island === 1)).toBe(true);
    expect(filterCandidates(candidates, { ...DEFAULT_FILTER, query: '0009' }).map((c) => c.id)).toEqual(['c-0009']);
  });
  it('sorts numerically, descending, and always sinks empty values', () => {
    const byFitness = sortCandidates(candidates, 'fitness', 'desc').map((c) => c.id);
    expect(byFitness.slice(0, 3)).toEqual(['c-0009', 'c-0003', 'c-0001']);
    expect(byFitness.slice(-4).every((id) => ['c-0004', 'c-0005', 'c-0006', 'c-0007', 'c-0008', 'c-0010'].includes(id))).toBe(true);
    const asc = sortCandidates(candidates, 'fitness', 'asc').map((c) => c.id);
    expect(asc[0]).toBe('c-0000');
    expect(sortCandidates(candidates, 'objective', 'asc', 'infidelity')[0].id).toBe('c-0009');
  });
});

describe('guardrail stats', () => {
  it('groups rejection reasons with candidate links, most common first', () => {
    const reasons = rejectionReasons(candidates);
    expect(reasons.map((r) => [r.guardrail, r.count])).toEqual([['no_noise', 1], ['qubit_count', 1]]);
    expect(reasons[0]).toMatchObject({ label: 'No noise channels', candidateIds: ['c-0004'] });
    expect(reasons[0].message).toMatch(/depolarizing/);
  });
  it('computes pass rates that ignore skipped checks', () => {
    const rates = guardrailPassRates(candidates);
    const noise = rates.find((r) => r.id === 'no_noise')!;
    expect(noise.fail).toBe(1);
    expect(noise.skipped).toBe(1);
    expect(noise.passRate).toBeCloseTo(noise.pass / (noise.pass + noise.fail));
  });
  it('reports the isolation mode and states what it does not block', () => {
    expect(isolationUsed(candidates)[0].mode).toBe('sandbox-exec');
    expect(isolationNote('sandbox-exec')).toMatch(/file reads are being restricted/);
    expect(isolationNote('process')).toMatch(/no OS sandbox/);
  });
  it('red queen copy says instructed, not forbidden, and reuses the sandbox constant', () => {
    expect(RED_QUEEN_EXPLAINER).not.toMatch(/forbidden/);
    expect(RED_QUEEN_EXPLAINER).toMatch(/instructed not to/);
    expect(RED_QUEEN_EXPLAINER).toContain(SANDBOX_HONESTY);
    expect(SANDBOX_HONESTY).toMatch(/blocks network access and file writes; file reads are being restricted/);
  });
  it('fixture run archive holds the elites', () => {
    expect(Object.values(fixtureRun().archive.islands[0]).length).toBeGreaterThan(0);
  });
});
