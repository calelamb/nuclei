import { describe, it, expect } from 'vitest';
import { splitMarkdownTables, splitTableRow } from './markdownTables';

describe('splitTableRow', () => {
  it('splits plain cells and trims outer pipes', () => {
    expect(splitTableRow('| a | b | c |')).toEqual(['a', 'b', 'c']);
  });

  it('keeps pipes inside backtick code spans (kets like `|00>`)', () => {
    expect(splitTableRow('| 0 | `|Φ⁺⟩` | `(|00⟩ + |11⟩) / √2` |'))
      .toEqual(['0', '`|Φ⁺⟩`', '`(|00⟩ + |11⟩) / √2`']);
  });

  it('honours escaped pipes', () => {
    expect(splitTableRow('| a \\| b | c |')).toEqual(['a | b', 'c']);
  });
});

describe('splitMarkdownTables', () => {
  it('returns one markdown block when there is no table', () => {
    expect(splitMarkdownTables('Hello\n\nworld')).toEqual([{ type: 'markdown', text: 'Hello\n\nworld' }]);
  });

  it('extracts a table between paragraphs', () => {
    const md = ['Intro', '', '| Index | Name |', '|-------|:----:|', '| 0 | Bell |', '| 1 | Other |', '', 'After'].join('\n');
    const blocks = splitMarkdownTables(md);
    expect(blocks.map((b) => b.type)).toEqual(['markdown', 'table', 'markdown']);
    expect(blocks[1]).toEqual({
      type: 'table',
      header: ['Index', 'Name'],
      align: [null, 'center'],
      rows: [['0', 'Bell'], ['1', 'Other']],
    });
  });

  it('does not treat table-looking lines inside a fenced code block as a table', () => {
    const md = ['```', '| a | b |', '|---|---|', '| 1 | 2 |', '```'].join('\n');
    expect(splitMarkdownTables(md)).toEqual([{ type: 'markdown', text: md }]);
  });

  it('ignores a pipe line without a separator row', () => {
    const md = '| just | text |\nnot a table';
    expect(splitMarkdownTables(md).every((b) => b.type === 'markdown')).toBe(true);
  });

  it('pads short rows to the header width', () => {
    const blocks = splitMarkdownTables('| a | b |\n|---|---|\n| 1 |');
    expect(blocks[0]).toMatchObject({ type: 'table', rows: [['1', '']] });
  });
});
