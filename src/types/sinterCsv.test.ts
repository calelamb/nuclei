import { describe, it, expect } from 'vitest';
import golden from './__fixtures__/sinter_golden.json';
import {
  parseSinterCsvDetailed,
  serializeSinterCsv,
  MAX_CSV_BYTES,
} from './sinterCsv';
import { parseSinterCsv } from './qecStats';

const HEADER = 'shots,errors,discards,seconds,decoder,strong_id,json_metadata,custom_counts';

describe('parseSinterCsvDetailed parity with sinter.read_stats_from_csv_files', () => {
  for (const c of golden.cases) {
    it(`matches sinter ${golden.sinter_version} output: ${c.name}`, () => {
      const result = parseSinterCsvDetailed(c.csv);
      expect(result.fatal).toBeNull();
      expect(result.issues).toEqual([]);
      expect(result.rows.length).toBe(c.expected.length);
      c.expected.forEach((exp, i) => {
        const got = result.rows[i];
        expect(got.strong_id).toBe(exp.strong_id);
        expect(got.decoder).toBe(exp.decoder);
        expect(got.json_metadata).toEqual(exp.json_metadata);
        expect(got.shots).toBe(exp.shots);
        expect(got.errors).toBe(exp.errors);
        expect(got.discards).toBe(exp.discards);
        expect(got.seconds).toBeCloseTo(exp.seconds, 12);
        expect(got.custom_counts).toEqual(exp.custom_counts);
      });
    });
  }

  for (const c of golden.raises) {
    it(`flags what sinter ${golden.sinter_version} raises on: ${c.name}`, () => {
      expect(c.sinter_error).toMatch(/same strong id/);
      const r = parseSinterCsvDetailed(c.csv);
      expect(r.fatal).toBeNull();
      expect(r.rows).toHaveLength(1);
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0].message).toMatch(/strong_id/);
    });
  }

  it('golden Counter case pins non-positive drops and prototype-named keys', () => {
    const c = golden.cases.find((x) => x.name === 'counter_rules_nonpositive_and_proto_keys')!;
    expect(c.expected[0].custom_counts).toEqual({ b: 1, constructor: 6, toString: 2 });
  });

  it('golden resume case really contains duplicates (guards the fixture)', () => {
    const c = golden.cases.find((x) => x.name === 'resume_duplicates_with_custom_counts')!;
    const dataLines = c.csv.trim().split('\n').length - 1;
    expect(dataLines).toBeGreaterThan(c.expected.length);
  });

  it('parseSinterCsv (tolerant API) aggregates duplicates too', () => {
    const c = golden.cases[0];
    expect(parseSinterCsv(c.csv).map((r) => r.shots)).toEqual(c.expected.map((e) => e.shots));
  });
});

describe('parseSinterCsvDetailed validation', () => {
  it('reports a visible per-row issue for malformed json_metadata and keeps good rows', () => {
    const csv = [
      HEADER,
      '100,1,0,0.1,pymatching,a,"{""d"":3,""p"":0.01}",',
      '100,1,0,0.1,pymatching,b,"{not json",',
      '100,1,0,0.1,pymatching,c,"{""d"":5,""p"":0.01}",',
    ].join('\n');
    const r = parseSinterCsvDetailed(csv);
    expect(r.rows.map((x) => x.strong_id)).toEqual(['a', 'c']);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].line).toBe(3);
    expect(r.issues[0].message).toMatch(/json_metadata/);
  });

  it('rejects rows failing the schema (negative, fractional, errors > shots, non-object metadata)', () => {
    const csv = [
      HEADER,
      '-5,0,0,0.1,m,a,"{}",',
      '10.5,0,0,0.1,m,b,"{}",',
      '10,11,0,0.1,m,c,"{}",',
      '10,1,0,0.1,m,d,"[1,2]",',
      '10,1,0,0.1,,e,"{}",', // empty decoder is allowed by sinter
      '10,1,0,0.1,m,,"{}",', // empty strong_id is not
      '10,1,0,0.1,m,g,"{}","{""x"":1.5}"', // custom counts must be ints
    ].join('\n');
    const r = parseSinterCsvDetailed(csv);
    expect(r.rows.map((x) => x.strong_id)).toEqual(['e']);
    expect(r.issues.map((i) => i.line)).toEqual([2, 3, 4, 5, 7, 8]);
  });

  it('flags same strong_id with conflicting metadata as an issue (sinter raises)', () => {
    const csv = [
      HEADER,
      '10,1,0,0.1,m,a,"{""d"":3}",',
      '10,1,0,0.1,m,a,"{""d"":5}",',
    ].join('\n');
    const r = parseSinterCsvDetailed(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].shots).toBe(10);
    expect(r.issues[0].message).toMatch(/strong_id/);
  });

  it('treats 1 and 1.0 metadata values as equal when merging (JSON equality)', () => {
    const csv = [HEADER, '10,1,0,0.1,m,a,"{""d"":1}",', '10,1,0,0.1,m,a,"{""d"":1.0}",'].join('\n');
    const r = parseSinterCsvDetailed(csv);
    expect(r.issues).toEqual([]);
    expect(r.rows[0].shots).toBe(20);
  });

  it('fails fatally on a non-sinter header, naming the missing columns', () => {
    const r = parseSinterCsvDetailed('a,b,c\n1,2,3');
    expect(r.rows).toEqual([]);
    expect(r.fatal).toMatch(/shots/);
    expect(r.fatal).toMatch(/strong_id/);
  });

  it('fails fatally on empty input and oversized input without parsing it', () => {
    expect(parseSinterCsvDetailed('').fatal).toMatch(/empty/i);
    const big = 'x'.repeat(MAX_CSV_BYTES + 1);
    expect(parseSinterCsvDetailed(big).fatal).toMatch(/too large/i);
  });

  it('handles CRLF, a BOM, and quoted fields containing newlines', () => {
    const csv = `\uFEFF${HEADER}\r\n10,1,0,0.1,m,a,"{""d"":3,\n""note"":""x""}",\r\n10,2,0,0.1,m,b,"{""d"":5}",\r\n`;
    const r = parseSinterCsvDetailed(csv);
    expect(r.issues).toEqual([]);
    expect((r.rows[0].json_metadata as Record<string, unknown>).note).toBe('x');
    expect(r.rows).toHaveLength(2);
  });

  it('keeps __proto__ in metadata as plain data (no prototype pollution)', () => {
    const csv = [HEADER, '10,1,0,0.1,m,a,"{""__proto__"":{""polluted"":1},""d"":3}",'].join('\n');
    const r = parseSinterCsvDetailed(csv);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(r.rows).toHaveLength(1);
  });

  it('caps the number of reported issues', () => {
    const bad = Array.from({ length: 200 }, () => '1,0,0,0,m,x,"{bad",').join('\n');
    const r = parseSinterCsvDetailed(`${HEADER}\n${bad}`);
    expect(r.issues.length).toBeLessThanOrEqual(26); // 25 + a summary entry
    expect(r.rows).toEqual([]);
  });
});

describe('serializeSinterCsv', () => {
  it('round-trips discards and custom_counts through parse', () => {
    const c = golden.cases[0];
    const rows = parseSinterCsvDetailed(c.csv).rows;
    const again = parseSinterCsvDetailed(serializeSinterCsv(rows));
    expect(again.issues).toEqual([]);
    expect(again.rows).toEqual(rows);
    expect(again.rows[0].discards).toBe(c.expected[0].discards);
    expect(again.rows[0].custom_counts).toEqual(c.expected[0].custom_counts);
  });
});
