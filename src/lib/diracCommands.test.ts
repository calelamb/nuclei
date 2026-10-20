import { describe, it, expect } from 'vitest';
import { filterSlashCommands, isUnfinishedSlashInput } from './diracCommands';

describe('slash commands', () => {
  it('filters by prefix', () => {
    expect(filterSlashCommands('/e').map((c) => c.command)).toEqual(['/explain', '/exercise']);
    expect(filterSlashCommands('/').length).toBe(5);
    expect(filterSlashCommands('/zzz')).toEqual([]);
  });

  it('flags bare slash input but not real questions', () => {
    expect(isUnfinishedSlashInput('/')).toBe(true);
    expect(isUnfinishedSlashInput('/exp')).toBe(true);
    expect(isUnfinishedSlashInput('/zzz')).toBe(true);
    expect(isUnfinishedSlashInput(' /explain ')).toBe(false);
    expect(isUnfinishedSlashInput('/fix')).toBe(false);
    expect(isUnfinishedSlashInput('/exercise')).toBe(false);
    expect(isUnfinishedSlashInput('/explain the bell state')).toBe(false);
    expect(isUnfinishedSlashInput('what is /dev/null')).toBe(false);
  });
});
