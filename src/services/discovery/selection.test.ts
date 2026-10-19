import { describe, expect, it } from 'vitest';
import { createArchive, insertElite, islandElites, type ArchiveElite } from './archive';
import { createRng } from './rng';
import { isMigrationGeneration, migrate, selectInspirations, selectParent } from './selection';
import { TOY_EVALUATOR } from './testkit';

const axes = [
  { key: 'd1', label: 'd1', min: 0, max: 10, bins: 5 },
  { key: 'd2', label: 'd2', min: 0, max: 100, bins: 4 },
] as const;

function elite(i: number, fitness: number, patch: Partial<ArchiveElite> = {}): ArchiveElite {
  const id = `c-${String(i).padStart(4, '0')}`;
  return { candidateId: id, island: 0, fitness, cost: 1, order: i, programHash: `h${i}`, cell: [i % 5, 0], descriptors: {}, objectives: { err: 1, cost: 1 }, ...patch };
}

function filled(islands: number, entries: ArchiveElite[]) {
  return entries.reduce((a, e) => insertElite(a, e).archive, createArchive(axes, TOY_EVALUATOR.objectives, islands));
}

describe('selectParent', () => {
  const archive = filled(1, [elite(1, 1), elite(2, 5), elite(3, 2), elite(4, 3), elite(5, 4)]);

  it('returns null for an empty archive', () => {
    expect(selectParent(createArchive(axes, TOY_EVALUATOR.objectives, 1), 0, createRng(1), 0)).toBeNull();
  });

  it('tournament selection favours fitter elites', () => {
    const rng = createRng(11);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 600; i += 1) {
      const p = selectParent(archive, 0, rng, 0)!;
      counts[p.candidateId] = (counts[p.candidateId] ?? 0) + 1;
    }
    expect(counts['c-0002']).toBeGreaterThan(counts['c-0001'] * 3);
  });

  it('exploration 1 picks uniformly', () => {
    const rng = createRng(12);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(selectParent(archive, 0, rng, 1)!.candidateId);
    expect(seen.size).toBe(5);
  });

  it('is deterministic for a seed and borrows globally for an empty island', () => {
    const two = filled(2, [elite(1, 1), elite(2, 5)]);
    const a = Array.from({ length: 5 }, ((r) => () => selectParent(two, 1, r, 0.3)!.candidateId)(createRng(3)));
    const b = Array.from({ length: 5 }, ((r) => () => selectParent(two, 1, r, 0.3)!.candidateId)(createRng(3)));
    expect(a).toEqual(b);
    expect(a.every((id) => id === 'c-0001' || id === 'c-0002')).toBe(true);
  });
});

describe('selectInspirations', () => {
  it('returns top-k other cells, deduplicated by program hash', () => {
    const archive = filled(2, [
      elite(1, 1), elite(2, 9), elite(3, 8, { programHash: 'h2' }), elite(4, 7), elite(5, 6, { island: 1 }),
    ]);
    const parent = islandElites(archive, 0).find((e) => e.candidateId === 'c-0001')!;
    const picks = selectInspirations(archive, parent, 3);
    expect(picks.map((e) => e.candidateId)).toEqual(['c-0002', 'c-0004', 'c-0005']);
    expect(picks.every((e) => e.candidateId !== parent.candidateId)).toBe(true);
    expect(selectInspirations(archive, parent, 0)).toEqual([]);
  });

  it('never repeats the parent program under another id', () => {
    const archive = filled(1, [elite(1, 1), elite(2, 9, { programHash: 'h1' })]);
    expect(selectInspirations(archive, islandElites(archive, 0).find((e) => e.candidateId === 'c-0001')!, 2)).toEqual([]);
  });
});

describe('migrate', () => {
  it('only fires on multiples of the interval', () => {
    expect(isMigrationGeneration(5, 5)).toBe(true);
    expect(isMigrationGeneration(4, 5)).toBe(false);
    expect(isMigrationGeneration(0, 5)).toBe(false);
    expect(isMigrationGeneration(5, 0)).toBe(false);
  });

  it('copies each island best to the next island in a ring', () => {
    const archive = filled(3, [
      elite(1, 5, { island: 0 }), elite(2, 7, { island: 1, cell: [1, 1] }), elite(3, 6, { island: 2, cell: [2, 2] }),
    ]);
    const { archive: next, migrations } = migrate(archive, 5, 5);
    expect(migrations.map((m) => [m.from, m.to, m.candidateId])).toEqual([[0, 1, 'c-0001'], [1, 2, 'c-0002'], [2, 0, 'c-0003']]);
    expect(islandElites(next, 1).map((e) => e.candidateId).sort()).toEqual(['c-0001', 'c-0002']);
    expect(islandElites(next, 0).map((e) => e.candidateId).sort()).toEqual(['c-0001', 'c-0003']);
    // Migrants are not relayed twice in one round.
    expect(islandElites(next, 2).map((e) => e.candidateId).sort()).toEqual(['c-0002', 'c-0003']);
  });

  it('is a no-op off-interval, with one island, or when disabled', () => {
    const archive = filled(2, [elite(1, 5)]);
    expect(migrate(archive, 4, 5).migrations).toEqual([]);
    expect(migrate(archive, 5, 0).archive).toBe(archive);
    expect(migrate(filled(1, [elite(1, 5)]), 5, 5).migrations).toEqual([]);
  });
});
