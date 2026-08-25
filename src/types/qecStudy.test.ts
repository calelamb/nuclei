import { describe, expect, it } from 'vitest';
import { parseQecStudyYaml, serializeQecStudy } from './qecStudy';

const minimalStudy = `schema: 1
id: surface-memory
name: Surface Memory
question: Does d=7 suppress errors?
preset: build
sources: []
`;

describe('parseQecStudyYaml', () => {
  it('parses a minimal schema-1 Study', () => {
    const result = parseQecStudyYaml(minimalStudy);

    expect(result).toEqual({
      ok: true,
      study: expect.objectContaining({
        id: 'surface-memory',
        preset: 'build',
        tags: [],
      }),
    });
  });

  it('rejects a source path that escapes the project', () => {
    const result = parseQecStudyYaml(`schema: 1
id: bad
name: Bad
question: Bad
preset: analyze
sources:
  - id: source
    kind: stim
    path: ../../outside.stim
`);

    expect(result).toEqual({
      ok: false,
      errors: expect.arrayContaining([expect.stringContaining('path')]),
    });
  });

  it.each(['/outside.stim', String.raw`\\server\share\outside.stim`])(
    'rejects POSIX and UNC absolute source paths: %s',
    (path) => {
      const result = parseQecStudyYaml(`schema: 1
id: bad
name: Bad
question: Bad
preset: analyze
sources:
  - id: source
    kind: stim
    path: ${JSON.stringify(path)}
`);

      expect(result).toEqual({
        ok: false,
        errors: expect.arrayContaining([expect.stringContaining('path')]),
      });
    },
  );

  it.each(['C:\\outside.stim', 'nested\\..\\outside.stim'])(
    'rejects Windows absolute and traversal source paths: %s',
    (path) => {
      const result = parseQecStudyYaml(`schema: 1
id: bad
name: Bad
question: Bad
preset: analyze
sources:
  - id: source
    kind: stim
    path: ${JSON.stringify(path)}
`);

      expect(result).toEqual({
        ok: false,
        errors: expect.arrayContaining([expect.stringContaining('path')]),
      });
    },
  );

  it('round-trips a valid Study through serialization', () => {
    const parsed = parseQecStudyYaml(`schema: 1
id: repetition-study
name: Repetition Study
question: Which decoder works best?
preset: observe
tags: [intro, decoder]
sources:
  - id: circuit
    kind: stim
    path: circuits/repetition.stim
`);

    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;

    expect(parseQecStudyYaml(serializeQecStudy(parsed.study))).toEqual(parsed);
  });

  it('normalizes source ids and rejects duplicates after normalization', () => {
    const normalized = parseQecStudyYaml(`schema: 1
id: source-ids
name: Source ids
question: Are source ids stable?
preset: build
sources:
  - id: " circuit "
    kind: stim
    path: circuits/a.stim
`);
    expect(normalized).toMatchObject({ ok: true, study: { sources: [{ id: 'circuit' }] } });

    const duplicate = parseQecStudyYaml(`schema: 1
id: source-ids
name: Source ids
question: Are source ids unique?
preset: build
sources:
  - id: " circuit "
    kind: stim
    path: circuits/a.stim
  - id: ｃircuit
    kind: stim
    path: circuits/b.stim
`);
    expect(duplicate).toEqual({
      ok: false,
      errors: expect.arrayContaining([expect.stringContaining('source ids must be unique')]),
    });
  });

  it('returns an actionable result for malformed YAML', () => {
    const result = parseQecStudyYaml('schema: 1\nid: [unterminated');

    expect(result).toEqual({
      ok: false,
      errors: [expect.stringContaining('YAML parse error:')],
    });
  });
});
