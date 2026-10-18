import { describe, expect, it } from 'vitest';
import { applyEdits, findRegion, occurrences, regionText } from './diff';

const PROGRAM = [
  'import q',
  'X = 1',
  '# EVOLVE-BLOCK-START',
  'a = 1',
  'b = 2',
  'for i in range(3):',
  '    c = i',
  '# EVOLVE-BLOCK-END',
  'X = 1',
  'def build():',
  '    return a',
  '',
].join('\n');

describe('applyEdits', () => {
  it('applies an edit inside the region and reports its line span', () => {
    const res = applyEdits(PROGRAM, [{ search: 'b = 2', replace: 'b = 3' }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.program).toContain('b = 3');
    expect(res.spans).toEqual([{ startLine: 5, endLine: 5 }]);
    expect(res.regionWarning).toBe(false);
  });

  it('applies several edits against the original program regardless of order', () => {
    const res = applyEdits(PROGRAM, [
      { search: 'b = 2', replace: 'b = 20' },
      { search: 'a = 1', replace: 'a = 10\na2 = 11' },
    ]);
    expect(res.ok && res.program).toContain('a = 10\na2 = 11\nb = 20');
  });

  it('spans multi-line matches', () => {
    const res = applyEdits(PROGRAM, [{ search: 'for i in range(3):\n    c = i', replace: 'pass' }]);
    expect(res.ok && res.spans).toEqual([{ startLine: 6, endLine: 7 }]);
  });

  it('rejects a search that matches more than once', () => {
    const res = applyEdits(PROGRAM.replace('a = 1', 'a = 1\na = 1'), [{ search: 'a = 1', replace: 'a = 2' }]);
    expect(res).toMatchObject({ ok: false, code: 'ambiguous_match' });
  });

  it('rejects a match that appears both inside and outside the region', () => {
    expect(applyEdits(PROGRAM, [{ search: 'X = 1', replace: 'X = 2' }])).toMatchObject({ ok: false, code: 'ambiguous_match' });
  });

  it('rejects text outside the region', () => {
    expect(applyEdits(PROGRAM, [{ search: 'import q', replace: 'import r' }])).toMatchObject({ ok: false, code: 'outside_region', editIndex: 0 });
    expect(applyEdits(PROGRAM, [{ search: 'return a', replace: 'return b' }])).toMatchObject({ ok: false, code: 'outside_region' });
  });

  it('rejects a match straddling the region boundary', () => {
    expect(applyEdits(PROGRAM, [{ search: 'c = i\n# EVOLVE-BLOCK-END', replace: 'c = i' }])).toMatchObject({ ok: false, code: 'touches_marker' });
    expect(applyEdits(PROGRAM, [{ search: 'X = 1\n# EVOLVE', replace: 'X' }])).toMatchObject({ ok: false });
  });

  it('protects both markers in search and replace', () => {
    for (const marker of ['# EVOLVE-BLOCK-START', '# EVOLVE-BLOCK-END']) {
      expect(applyEdits(PROGRAM, [{ search: marker, replace: '' }])).toMatchObject({ ok: false, code: 'touches_marker' });
      expect(applyEdits(PROGRAM, [{ search: 'b = 2', replace: `b = 2\n${marker}` }])).toMatchObject({ ok: false, code: 'touches_marker' });
    }
  });

  it('rejects empty and missing searches', () => {
    expect(applyEdits(PROGRAM, [{ search: '', replace: 'x' }])).toMatchObject({ ok: false, code: 'empty_search' });
    expect(applyEdits(PROGRAM, [{ search: 'zzz', replace: 'x' }])).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('rejects overlapping edits', () => {
    expect(applyEdits(PROGRAM, [{ search: 'a = 1\nb = 2', replace: 'x' }, { search: 'b = 2', replace: 'y' }])).toMatchObject({ ok: false, code: 'overlapping_edits' });
  });

  it('is idempotent-safe: re-applying the same edit never double-applies', () => {
    const edits = [{ search: 'b = 2', replace: 'b = 3' }];
    const once = applyEdits(PROGRAM, edits);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    expect(applyEdits(once.program, edits)).toMatchObject({ ok: false, code: 'already_applied' });
  });

  it('rejects no-op edits', () => {
    expect(applyEdits(PROGRAM, [{ search: 'b = 2', replace: 'b = 2' }])).toMatchObject({ ok: false, code: 'no_change' });
  });

  it('treats the whole file as the region, with a warning, when markers are absent', () => {
    const res = applyEdits('a = 1\nb = 2\n', [{ search: 'b = 2', replace: 'b = 3' }]);
    expect(res).toMatchObject({ ok: true, regionWarning: true, program: 'a = 1\nb = 3\n' });
  });

  it('rejects a lone, duplicated or reversed marker', () => {
    expect(applyEdits('# EVOLVE-BLOCK-START\na\n', [{ search: 'a', replace: 'b' }])).toMatchObject({ ok: false, code: 'bad_markers' });
    expect(applyEdits('# EVOLVE-BLOCK-END\na\n# EVOLVE-BLOCK-START\n', [{ search: 'a', replace: 'b' }])).toMatchObject({ ok: false, code: 'bad_markers' });
    expect(applyEdits(`${PROGRAM}# EVOLVE-BLOCK-START\n`, [{ search: 'b = 2', replace: 'x' }])).toMatchObject({ ok: false, code: 'bad_markers' });
  });

  it('allows deleting the last region line', () => {
    expect(applyEdits(PROGRAM, [{ search: '    c = i\n', replace: '    pass\n' }]).ok).toBe(true);
  });
});

describe('helpers', () => {
  it('counts overlapping occurrences', () => {
    expect(occurrences('aaa', 'aa')).toEqual([0, 1]);
  });
  it('finds the region and its text', () => {
    const found = findRegion(PROGRAM);
    expect(found.ok && found.region.wholeFile).toBe(false);
    expect(regionText(PROGRAM)).toBe('a = 1\nb = 2\nfor i in range(3):\n    c = i\n');
    expect(regionText('x = 1')).toBe('x = 1');
  });
});
