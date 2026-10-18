import { describe, expect, it } from 'vitest';
import {
  allElites, binIndex, bestElite, createArchive, crowdingDistance, eliteFromEvaluation, insertElite,
  isArchiveEligible, nonDominatedSort, paretoFront, rankElites, type ArchiveElite,
} from './archive';
import { TOY_EVALUATOR, makeEvaluation } from './testkit';

const axes = [
  { key: 'd1', label: 'd1', min: 0, max: 10, bins: 5 },
  { key: 'd2', label: 'd2', min: 0, max: 100, bins: 4 },
] as const;

function archive(islands = 2) {
  return createArchive(axes, TOY_EVALUATOR.objectives, islands);
}

function elite(id: string, patch: Partial<ArchiveElite> = {}): ArchiveElite {
  return {
    candidateId: id, island: 0, fitness: 1, cost: 5, order: Number(id.slice(2)), programHash: id, cell: [0, 0],
    descriptors: {}, objectives: { err: 0.1, cost: 5 }, ...patch,
  };
}

describe('binIndex', () => {
  it('bins inside the range and clamps outside it', () => {
    expect(binIndex(0, axes[0])).toBe(0);
    expect(binIndex(1.99, axes[0])).toBe(0);
    expect(binIndex(2, axes[0])).toBe(1);
    expect(binIndex(10, axes[0])).toBe(4);
    expect(binIndex(99, axes[0])).toBe(4);
    expect(binIndex(-5, axes[0])).toBe(0);
    expect(binIndex(Number.NaN, axes[0])).toBe(0);
  });
});

describe('MAP-Elites cells', () => {
  it('keeps the highest-fitness elite per cell', () => {
    const first = insertElite(archive(), elite('c-0001', { fitness: 1 }));
    expect(first.accepted).toBe(true);
    const better = insertElite(first.archive, elite('c-0002', { fitness: 2 }));
    expect(better.accepted).toBe(true);
    expect(better.replaced?.candidateId).toBe('c-0001');
    const worse = insertElite(better.archive, elite('c-0003', { fitness: 1.5 }));
    expect(worse.accepted).toBe(false);
    expect(allElites(worse.archive).map((e) => e.candidateId)).toEqual(['c-0002']);
  });

  it('breaks fitness ties by lower cost, then by the earlier candidate', () => {
    let a = insertElite(archive(), elite('c-0005', { cost: 5 })).archive;
    expect(insertElite(a, elite('c-0006', { cost: 4 })).accepted).toBe(true);
    expect(insertElite(a, elite('c-0006', { cost: 6 })).accepted).toBe(false);
    expect(insertElite(a, elite('c-0006', { cost: 5 })).accepted).toBe(false);
    a = insertElite(archive(), elite('c-0009', { cost: 5 })).archive;
    expect(insertElite(a, elite('c-0002', { cost: 5 })).accepted).toBe(true);
  });

  it('keeps islands separate and ignores unknown islands', () => {
    let a = insertElite(archive(), elite('c-0001', { island: 0 })).archive;
    a = insertElite(a, elite('c-0002', { island: 1, fitness: 0.5 })).archive;
    expect(Object.keys(a.islands[0])).toHaveLength(1);
    expect(Object.keys(a.islands[1])).toHaveLength(1);
    expect(insertElite(a, elite('c-0003', { island: 7 })).accepted).toBe(false);
  });

  it('does not mutate the input archive', () => {
    const before = archive();
    insertElite(before, elite('c-0001'));
    expect(allElites(before)).toHaveLength(0);
  });

  it('is plain JSON', () => {
    const a = insertElite(archive(), elite('c-0001')).archive;
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});

describe('eligibility', () => {
  it('admits only scored full/confirm evaluations', () => {
    expect(isArchiveEligible(makeEvaluation({ stage: 'full' }))).toBe(true);
    expect(isArchiveEligible(makeEvaluation({ stage: 'confirm' }))).toBe(true);
    expect(isArchiveEligible(makeEvaluation({ stage: 'screen' }))).toBe(false);
    expect(isArchiveEligible(makeEvaluation({ stage: undefined }))).toBe(false);
    expect(isArchiveEligible(makeEvaluation({ status: 'rejected', fitness: null }))).toBe(false);
    expect(isArchiveEligible(makeEvaluation({ status: 'failed', fitness: null }))).toBe(false);
    expect(isArchiveEligible(makeEvaluation({ fitness: Number.NaN }))).toBe(false);
  });

  it('builds an elite with cell, cost and order from an evaluation', () => {
    const e = eliteFromEvaluation(archive(), { candidateId: 'c-0007', island: 1, programHash: 'h' }, makeEvaluation({ descriptors: { d1: 5, d2: 60 } }));
    expect(e).toMatchObject({ candidateId: 'c-0007', island: 1, cell: [2, 2], cost: 5, order: 7 });
    expect(eliteFromEvaluation(archive(), { candidateId: 'c-0007', island: 1, programHash: 'h' }, makeEvaluation({ stage: 'screen' }))).toBeNull();
  });
});

describe('Pareto', () => {
  const defs = TOY_EVALUATOR.objectives.map(({ key, label, direction }) => ({ key, label, direction }));
  const p = (id: string, err: number, cost: number) => elite(id, { objectives: { err, cost } });

  it('sorts into non-dominated fronts (minimize both)', () => {
    const pts = [p('c-1', 1, 5), p('c-2', 2, 3), p('c-3', 3, 1), p('c-4', 2, 5), p('c-5', 4, 6)];
    const fronts = nonDominatedSort(pts, defs);
    expect(fronts[0].sort()).toEqual([0, 1, 2]);
    expect(fronts[1]).toEqual([3]);
    expect(fronts[2]).toEqual([4]);
  });

  it('respects maximize direction', () => {
    const maxDefs = [{ key: 'err', label: 'e', direction: 'maximize' as const }, { key: 'cost', label: 'c', direction: 'minimize' as const }];
    const pts = [p('c-1', 1, 5), p('c-2', 2, 5)];
    expect(nonDominatedSort(pts, maxDefs)[0]).toEqual([1]);
  });

  it('gives boundary points infinite crowding and interior points a finite share', () => {
    const pts = [p('c-1', 1, 5), p('c-2', 2, 3), p('c-3', 3, 1)];
    const crowd = crowdingDistance(pts, [0, 1, 2], defs);
    expect(crowd.get(0)).toBe(Infinity);
    expect(crowd.get(2)).toBe(Infinity);
    expect(crowd.get(1)).toBeCloseTo(2, 10);
    const more = [p('c-1', 1, 9), p('c-2', 2, 6), p('c-3', 2.1, 5), p('c-4', 5, 1)];
    const c = crowdingDistance(more, [0, 1, 2, 3], defs);
    expect(c.get(2)!).toBeGreaterThan(c.get(1)!);
  });

  it('ranks with crowding and exposes the global front without duplicates', () => {
    const ranked = rankElites([p('c-1', 1, 5), p('c-2', 2, 3), p('c-3', 3, 4)], defs);
    expect(ranked.map((r) => r.rank)).toEqual([0, 0, 1]);
    let a = insertElite(archive(), elite('c-0001', { objectives: { err: 1, cost: 5 }, cell: [0, 0] })).archive;
    a = insertElite(a, elite('c-0001', { island: 1, objectives: { err: 1, cost: 5 }, cell: [0, 0] })).archive;
    a = insertElite(a, elite('c-0002', { objectives: { err: 3, cost: 1 }, cell: [1, 0] })).archive;
    expect(paretoFront(a).map((e) => e.candidateId).sort()).toEqual(['c-0001', 'c-0002']);
    expect(bestElite(a)?.candidateId).toBe('c-0001');
  });
});
