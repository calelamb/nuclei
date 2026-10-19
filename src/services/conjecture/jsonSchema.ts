/**
 * A small JSON Schema validator for the subset the kernel's conjecture
 * schemas use (type, enum, const, bounds, items, required, properties,
 * additionalProperties, anyOf/oneOf/allOf, local $ref). Unknown keywords are
 * ignored: the kernel stays the authority and re-validates every conjecture
 * (`invalid_conjecture`); this exists to fail fast with a path in the UI.
 */

import type { JsonSchema } from '../../types/conjecture';

export interface SchemaIssue {
  path: string;
  message: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function typeOk(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isObject(value);
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function resolveRef(root: JsonSchema, ref: string): JsonSchema | null {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) return null;
  let node: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    if (!isObject(node)) return null;
    node = node[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return isObject(node) ? node : null;
}

function join(path: string, key: string | number): string {
  return typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key;
}

const MAX_DEPTH = 24;

function check(schema: JsonSchema, value: unknown, path: string, root: JsonSchema, depth: number): SchemaIssue[] {
  if (depth > MAX_DEPTH) return [];
  const at = path || 'value';
  if (typeof schema.$ref === 'string') {
    const target = resolveRef(root, schema.$ref);
    return target ? check(target, value, path, root, depth + 1) : [];
  }
  const issues: SchemaIssue[] = [];
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
  if (types.length > 0 && !types.some((t) => typeOk(t, value))) {
    return [{ path: at, message: `must be ${types.join(' or ')}` }];
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    issues.push({ path: at, message: `must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}` });
  }
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) {
    issues.push({ path: at, message: `must equal ${JSON.stringify(schema.const)}` });
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) issues.push({ path: at, message: `must be at least ${schema.minimum}` });
    if (typeof schema.maximum === 'number' && value > schema.maximum) issues.push({ path: at, message: `must be at most ${schema.maximum}` });
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) issues.push({ path: at, message: `must have at least ${schema.minLength} characters` });
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) issues.push({ path: at, message: `must have at most ${schema.maxLength} characters` });
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern).test(value)) issues.push({ path: at, message: `must match ${schema.pattern}` });
      } catch {
        /* an unparsable pattern is the kernel's to enforce */
      }
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) issues.push({ path: at, message: `needs at least ${schema.minItems} items` });
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) issues.push({ path: at, message: `allows at most ${schema.maxItems} items` });
    const prefix = Array.isArray(schema.prefixItems) ? (schema.prefixItems as JsonSchema[]) : [];
    value.forEach((item, i) => {
      const itemSchema = prefix[i] ?? (isObject(schema.items) ? schema.items : null);
      if (itemSchema) issues.push(...check(itemSchema, item, join(path, i), root, depth + 1));
    });
  }
  if (isObject(value)) {
    const props = isObject(schema.properties) ? (schema.properties as Record<string, JsonSchema>) : {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!(key in value)) issues.push({ path: join(path, key), message: 'is required' });
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in value) issues.push(...check(sub, value[key], join(path, key), root, depth + 1));
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) issues.push({ path: join(path, key), message: 'is not allowed' });
      }
    }
  }
  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const branches = schema[keyword];
    if (Array.isArray(branches) && branches.length > 0) {
      const ok = (branches as JsonSchema[]).some((b) => check(b, value, path, root, depth + 1).length === 0);
      if (!ok) issues.push({ path: at, message: 'does not match any allowed form' });
    }
  }
  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf as JsonSchema[]) issues.push(...check(sub, value, path, root, depth + 1));
  }
  return issues;
}

/** Validate `value` against `schema`; `path` prefixes reported issue paths. */
export function validateAgainstSchema(schema: JsonSchema, value: unknown, path = ''): SchemaIssue[] {
  return check(schema, value, path, schema, 0);
}
