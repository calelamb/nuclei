import { describe, expect, it, vi } from 'vitest';
import { groupByCategory } from './groupCommands';

const c = (id: string, category: string) => ({ id, label: id, category, action: vi.fn() });

describe('groupByCategory', () => {
  it('keeps categories in first-appearance order and gathers scattered commands together', () => {
    const groups = groupByCategory([c('a', 'Navigate'), c('b', 'View'), c('c', 'Navigate'), c('d', 'Run')]);
    expect(groups.map((g) => g.category)).toEqual(['Navigate', 'View', 'Run']);
    expect(groups[0].commands.map((x) => x.id)).toEqual(['a', 'c']);
  });
  it('returns nothing for nothing', () => {
    expect(groupByCategory([])).toEqual([]);
  });
});
