// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { escapeCsvCell, svgToDownloadableString, toCsv } from './experimentExport';

describe('escapeCsvCell', () => {
  it('leaves a plain value untouched', () => {
    expect(escapeCsvCell('hello')).toBe('hello');
  });

  it('quotes a value containing a comma', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes a value containing a newline', () => {
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('quotes a value containing a carriage return', () => {
    expect(escapeCsvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });
});

describe('toCsv', () => {
  it('builds a header + row for a simple shape', () => {
    const csv = toCsv([{ a: 1, b: 'x' }], ['a', 'b']);
    expect(csv).toBe('a,b\r\n1,x');
  });

  it('escapes commas/quotes/newlines that appear inside cell values', () => {
    const csv = toCsv(
      [{ note: 'contains, a comma' }, { note: 'has "quotes"' }, { note: 'multi\nline' }],
      ['note'],
    );
    expect(csv).toBe('note\r\n"contains, a comma"\r\n"has ""quotes"""\r\n"multi\nline"');
  });

  it('renders missing keys as empty cells', () => {
    const csv = toCsv([{ a: 1 }], ['a', 'b']);
    expect(csv).toBe('a,b\r\n1,');
  });

  it('renders booleans as lowercase true/false and null/undefined as empty', () => {
    const csv = toCsv([{ ok: true, bad: false, missing: null, absent: undefined }], ['ok', 'bad', 'missing', 'absent']);
    expect(csv).toBe('ok,bad,missing,absent\r\ntrue,false,,');
  });

  it('serializes a runs-table shape (params + status + metrics columns)', () => {
    const rows = [
      { run: '20260712-000001-aaaa', theta: 0, status: 'complete', energy: -1.5 },
      { run: '20260712-000002-bbbb', theta: 1, status: 'failed', energy: null },
    ];
    const csv = toCsv(rows, ['run', 'theta', 'status', 'energy']);
    expect(csv).toBe(
      'run,theta,status,energy\r\n' +
        '20260712-000001-aaaa,0,complete,-1.5\r\n' +
        '20260712-000002-bbbb,1,failed,',
    );
  });

  it('serializes a sweep-series shape (group + x + y + run)', () => {
    const rows = [
      { group: '1', x: 0, y: -0.1, run: 'c' },
      { group: '1', x: 1, y: -0.2, run: 'd' },
      { group: '2', x: 0, y: -1, run: 'a' },
    ];
    const csv = toCsv(rows, ['group', 'x', 'y', 'run']);
    expect(csv).toBe('group,x,y,run\r\n1,0,-0.1,c\r\n1,1,-0.2,d\r\n2,0,-1,a');
  });

  it('produces just a header for an empty row set', () => {
    expect(toCsv([], ['a', 'b'])).toBe('a,b');
  });
});

describe('svgToDownloadableString', () => {
  it('serializes an svg element and prefixes an XML prolog', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100');
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', '5');
    svg.appendChild(circle);

    const source = svgToDownloadableString(svg);
    expect(source.startsWith('<?xml version="1.0" standalone="no"?>')).toBe(true);
    expect(source).toContain('<svg');
    expect(source).toContain('<circle');
  });
});
