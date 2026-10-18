import { describe, expect, it } from 'vitest';
import { fixtureConjecture, fixtureSchema, FIXTURE_SCHEMA_REPLY } from './fixtures';
import { validateAgainstSchema } from './jsonSchema';
import { buildProposeTool, normalizeSchemaResult } from './schema';
import { validateConjecture } from './validate';

describe('normalizeSchemaResult', () => {
  it('keeps the per-quantity ops and value type (they used to be dropped)', () => {
    const info = normalizeSchemaResult(FIXTURE_SCHEMA_REPLY);
    expect(info?.quantities.find((q) => q.key === 'verdict')).toMatchObject({ ops: ['==', '!=', 'in'], value_type: 'string' });
    expect(info?.quantities.find((q) => q.key === 'beta_upper95')?.ops).toEqual(['<', '<=', '>', '>=']);
  });

  it('accepts string quantities and rejects incomplete replies', () => {
    const info = normalizeSchemaResult({ ...FIXTURE_SCHEMA_REPLY, quantities: ['beta_upper95', 'verdict'] });
    expect(info?.quantities).toEqual([{ key: 'beta_upper95', description: '' }, { key: 'verdict', description: '' }]);
    expect(normalizeSchemaResult({ ...FIXTURE_SCHEMA_REPLY, features: [] })).toBeNull();
  });
});

describe('buildProposeTool', () => {
  it('builds the forced tool from the kernel schema (snapshot)', () => {
    expect(buildProposeTool(fixtureSchema())).toMatchSnapshot();
  });

  it('gives each quantity only its own operators and value type (CR contract)', () => {
    const tool = buildProposeTool(fixtureSchema());
    const item = (tool.input_schema as { properties: { conjectures: { items: { properties: { prediction: { oneOf: Array<{ properties: { quantity: { enum: string[] }; op: { enum: string[] }; value: { type: unknown } } }> } } } } } }).properties.conjectures.items;
    const branches = item.properties.prediction.oneOf;
    const byQuantity = Object.fromEntries(branches.map((b) => [b.properties.quantity.enum[0], b.properties]));
    expect(byQuantity.verdict.op.enum).toEqual(['==', '!=', 'in']);
    expect(byQuantity.verdict.value.type).toBe('string');
    expect(byQuantity.beta_upper95.op.enum).toEqual(['<', '<=', '>', '>=']);
    expect(byQuantity.beta_upper95.value.type).toBe('number');
    expect(tool.description).toContain('verdict (ops == != in, string)');
  });

  it('hoists local $defs and rewrites refs so the schema stays self-contained', () => {
    const tool = buildProposeTool(fixtureSchema());
    const text = JSON.stringify(tool.input_schema);
    expect(text).not.toContain('"#/$defs/node"');
    expect(text).toContain('#/$defs/predicate__node');
    const defs = (tool.input_schema as { $defs: Record<string, unknown> }).$defs;
    expect(Object.keys(defs)).toContain('predicate__node');
  });

  it('lists the kernel features and quantities in the tool description', () => {
    const tool = buildProposeTool(fixtureSchema());
    expect(tool.description).toContain('entangler_pattern (string)');
    expect(tool.description).toContain('log2_dla_dimension');
  });
});

describe('validateAgainstSchema', () => {
  it('reports paths for type, bound, enum and required problems', () => {
    const issues = validateAgainstSchema(fixtureSchema().families, { family: 'layered', pattern: 'zigzag', layers: 0 }, 'test_family');
    const paths = issues.map((i) => i.path);
    expect(paths).toContain('test_family.pattern');
    expect(paths).toContain('test_family.layers');
    expect(paths).toContain('test_family.entangler');
  });
});

describe('validateConjecture', () => {
  const schema = fixtureSchema();
  it('accepts a good conjecture, including nested predicates', () => {
    expect(validateConjecture(fixtureConjecture(), schema).ok).toBe(true);
    const nested = fixtureConjecture({
      feature_predicate: { all: [{ any: [{ feature: 'n_layers', op: '>', value: 2 }, { feature: 'entangler', op: 'in', value: ['cz', 'cx'] }] }] },
    });
    expect(validateConjecture(nested, schema).ok).toBe(true);
  });

  it('flags unknown features, bad ranges and unknown quantities', () => {
    const bad = fixtureConjecture({
      feature_predicate: { all: [{ feature: 'magic', op: '==', value: 1 }] },
      prediction: { quantity: 'fidelity', op: '<', value: 0.1 },
      n_range: [8, 200],
      circuits: 3,
      points: 9,
    });
    const res = validateConjecture(bad, schema);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const paths = res.issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['feature_predicate.all[0].feature', 'prediction.quantity', 'n_range', 'circuits', 'points']));
  });

  it('rejects an operator or value type the quantity does not support, before the kernel does', () => {
    const noEq = validateConjecture(fixtureConjecture({ prediction: { quantity: 'beta_upper95', op: '==', value: 0.1 } }), schema);
    expect(noEq.ok).toBe(false);
    if (!noEq.ok) expect(noEq.issues.map((i) => i.path)).toContain('prediction.op');
    const ordering = validateConjecture(fixtureConjecture({ prediction: { quantity: 'verdict', op: '<', value: 'exponential' } }), schema);
    expect(ordering.ok).toBe(false);
    const wrongType = validateConjecture(fixtureConjecture({ prediction: { quantity: 'verdict', op: '==', value: 3 } }), schema);
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) expect(wrongType.issues.map((i) => i.path)).toContain('prediction.value');
    expect(validateConjecture(fixtureConjecture({ prediction: { quantity: 'verdict', op: '==', value: 'exponential' } }), schema).ok).toBe(true);
  });

  it('never throws on junk', () => {
    expect(validateConjecture('nope', schema).ok).toBe(false);
    expect(validateConjecture({ feature_predicate: 'x' }, schema).ok).toBe(false);
  });
});
