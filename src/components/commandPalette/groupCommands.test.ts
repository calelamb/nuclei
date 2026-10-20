import { describe, expect, it, vi } from 'vitest';
import { groupByCategory } from './groupCommands';

const c = (id: string, category: string) => ({ id, label: id, category, action: vi.fn() });

describe('groupByCategory', () => {
  it('keeps categories in first-appearance order and gathers scattered commands together', () => {
    const groups = groupByCategory([c('a', 'Navigate'), c('b', 'View'), c('c', 'Navigate'), c('d', 'Run')]);
    expect(groups.map((g) => g.category)).toEqual(['Navigate', 'View', 'Run']);
    expect(groups[0].commands.map((x) => x.id)).toEqual(['a', 'c']);
  });
  it('puts Help last and known categories in the fixed order whatever the registration order', () => {
    const groups = groupByCategory([c('h', 'Help'), c('a', 'Navigate'), c('v', 'View'), c('x', 'Mystery'), c('r', 'Run'), c('f', 'File')]);
    expect(groups.map((g) => g.category)).toEqual(['Navigate', 'View', 'Run', 'File', 'Help', 'Mystery']);
  });
  it('returns nothing for nothing', () => {
    expect(groupByCategory([])).toEqual([]);
  });
});
