/** Client-side validation of a conjecture against the kernel's schema. Never throws. */

import {
  PREDICATE_OPS,
  type Conjecture,
  type ConjectureSchemaInfo,
  type PredicateNode,
} from '../../types/conjecture';
import { validateAgainstSchema, type SchemaIssue } from './jsonSchema';

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const MAX_PREDICATE_DEPTH = 6;

function checkNode(node: unknown, path: string, featureKeys: Set<string>, depth: number): SchemaIssue[] {
  if (!isObject(node)) return [{ path, message: 'must be an object' }];
  if (depth > MAX_PREDICATE_DEPTH) return [{ path, message: 'is nested too deeply' }];
  const group = 'all' in node ? 'all' : 'any' in node ? 'any' : null;
  if (group) {
    const children = node[group];
    if (!Array.isArray(children) || children.length === 0) return [{ path: `${path}.${group}`, message: 'needs at least one clause' }];
    return children.flatMap((child, i) => checkNode(child as PredicateNode, `${path}.${group}[${i}]`, featureKeys, depth + 1));
  }
  const issues: SchemaIssue[] = [];
  if (typeof node.feature !== 'string' || !featureKeys.has(node.feature)) {
    issues.push({ path: `${path}.feature`, message: `must be one of the kernel features (${[...featureKeys].join(', ')})` });
  }
  if (typeof node.op !== 'string' || !(PREDICATE_OPS as readonly string[]).includes(node.op)) {
    issues.push({ path: `${path}.op`, message: `must be one of ${PREDICATE_OPS.join(', ')}` });
  } else if (node.op === 'in' && !Array.isArray(node.value)) {
    issues.push({ path: `${path}.value`, message: 'must be a list when op is "in"' });
  }
  if (!('value' in node)) issues.push({ path: `${path}.value`, message: 'is required' });
  return issues;
}

function checkScalars(raw: Record<string, unknown>, schema: ConjectureSchemaInfo): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  if (typeof raw.id !== 'string' || raw.id.trim() === '') issues.push({ path: 'id', message: 'must be a non-empty string' });
  if (typeof raw.statement !== 'string' || raw.statement.trim() === '') issues.push({ path: 'statement', message: 'must be a non-empty string' });
  const range = raw.n_range;
  if (!Array.isArray(range) || range.length !== 2 || !range.every((n) => Number.isInteger(n) && n >= 2 && n <= schema.limits.n_max)) {
    issues.push({ path: 'n_range', message: `must be [n_min, n_max] with whole numbers from 2 to ${schema.limits.n_max}` });
  } else if ((range[0] as number) >= (range[1] as number)) {
    issues.push({ path: 'n_range', message: 'n_min must be below n_max' });
  }
  const bound = (key: 'circuits' | 'points', [lo, hi]: readonly [number, number]) => {
    const v = raw[key];
    if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) issues.push({ path: key, message: `must be a whole number from ${lo} to ${hi}` });
  };
  bound('circuits', schema.limits.circuits);
  bound('points', schema.limits.points);
  return issues;
}

export function validateConjecture(
  raw: unknown,
  schema: ConjectureSchemaInfo,
): { ok: true; conjecture: Conjecture } | { ok: false; issues: SchemaIssue[] } {
  if (!isObject(raw)) return { ok: false, issues: [{ path: 'conjecture', message: 'must be an object' }] };
  const issues = checkScalars(raw, schema);
  const featureKeys = new Set(schema.features.map((f) => f.key));
  issues.push(...checkNode(raw.feature_predicate, 'feature_predicate', featureKeys, 0));
  const top = raw.feature_predicate;
  if (isObject(top) && !('all' in top) && !('any' in top)) {
    issues.push({ path: 'feature_predicate', message: 'must be {all: [...]} or {any: [...]} at the top level' });
  }
  issues.push(...validateAgainstSchema(schema.predicate, raw.feature_predicate, 'feature_predicate'));

  const prediction = raw.prediction;
  const quantityKeys = schema.quantities.map((q) => q.key);
  if (!isObject(prediction)) {
    issues.push({ path: 'prediction', message: 'must be an object' });
  } else {
    if (typeof prediction.quantity !== 'string' || !quantityKeys.includes(prediction.quantity)) {
      issues.push({ path: 'prediction.quantity', message: `must be one of ${quantityKeys.join(', ')}` });
    }
    if (typeof prediction.op !== 'string' || !(PREDICATE_OPS as readonly string[]).includes(prediction.op)) {
      issues.push({ path: 'prediction.op', message: `must be one of ${PREDICATE_OPS.join(', ')}` });
    }
    if (typeof prediction.value !== 'number' && typeof prediction.value !== 'string') {
      issues.push({ path: 'prediction.value', message: 'must be a number or a string' });
    }
  }
  issues.push(...validateAgainstSchema(schema.families, raw.test_family, 'test_family'));
  const seen = new Set<string>();
  const unique = issues.filter((i) => {
    const key = `${i.path}|${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length > 0 ? { ok: false, issues: unique } : { ok: true, conjecture: raw as unknown as Conjecture };
}
