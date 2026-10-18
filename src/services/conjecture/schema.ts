/**
 * The kernel's conjecture schema (`discovery_conjecture_schema_result`) and
 * the Claude tool built from it. The tool's JSON schema is derived, never
 * hand-copied: features, quantities and family fields always match the
 * kernel that will test the conjectures.
 */

import {
  CIRCUITS_RANGE,
  MAX_CONJECTURES,
  MAX_N_QUBITS,
  POINTS_RANGE,
  PREDICATE_OPS,
  type ConjectureQuantityInfo,
  type ConjectureResponse,
  type ConjectureSchemaInfo,
  type JsonSchema,
} from '../../types/conjecture';

export const PROPOSE_TOOL_NAME = 'propose_conjectures';
export const MAX_STATEMENT = 400;

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function normalizeQuantity(raw: unknown): ConjectureQuantityInfo | null {
  if (typeof raw === 'string') return raw ? { key: raw, description: '' } : null;
  if (!isObject(raw)) return null;
  const key = [raw.key, raw.name, raw.quantity].find((k) => typeof k === 'string' && k) as string | undefined;
  if (!key) return null;
  return { key, description: typeof raw.description === 'string' ? raw.description : '' };
}

/** Normalise a schema reply; null when it lacks the pieces a proposer needs. */
export function normalizeSchemaResult(
  message: Extract<ConjectureResponse, { type: 'discovery_conjecture_schema_result' }>,
): ConjectureSchemaInfo | null {
  const features = Array.isArray(message.features)
    ? message.features.filter((f) => isObject(f) && typeof f.key === 'string')
    : [];
  const quantities = (Array.isArray(message.quantities) ? message.quantities : [])
    .map(normalizeQuantity)
    .filter((q): q is ConjectureQuantityInfo => q !== null);
  if (features.length === 0 || quantities.length === 0 || !isObject(message.families) || !isObject(message.predicate)) {
    return null;
  }
  return {
    features: features.map((f) => ({ key: f.key, type: String(f.type ?? ''), description: String(f.description ?? '') })),
    quantities,
    families: message.families,
    predicate: message.predicate,
  };
}

const REF_PREFIXES = ['#/$defs/', '#/definitions/'];

/** Move a sub-schema's local `$defs` under a prefix so several schemas can share one root. */
function hoist(schema: JsonSchema, prefix: string, defs: Record<string, unknown>): JsonSchema {
  const rootName = `${prefix}root`;
  const rewrite = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(rewrite);
    if (!isObject(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') {
        const base = REF_PREFIXES.find((p) => value.startsWith(p));
        out[key] = value === '#' ? `#/$defs/${rootName}` : base ? `#/$defs/${prefix}${value.slice(base.length)}` : value;
      } else if (key === '$defs' || key === 'definitions') {
        continue;
      } else if (key === '$schema' || key === '$id') {
        continue;
      } else {
        out[key] = rewrite(value);
      }
    }
    return out;
  };
  const local = { ...(isObject(schema.$defs) ? schema.$defs : {}), ...(isObject(schema.definitions) ? schema.definitions : {}) };
  for (const [name, def] of Object.entries(local)) defs[`${prefix}${name}`] = rewrite(def);
  const body = rewrite(schema) as JsonSchema;
  if (Object.keys(local).length === 0 && JSON.stringify(schema).indexOf('"#"') < 0) return body;
  defs[rootName] = body;
  return { $ref: `#/$defs/${rootName}` };
}

export interface ProposeTool {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

export function buildConjectureItemSchema(schema: ConjectureSchemaInfo, defs: Record<string, unknown> = {}): JsonSchema {
  const quantityKeys = schema.quantities.map((q) => q.key);
  return {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Short unique id such as "c1".' },
      statement: {
        type: 'string',
        maxLength: MAX_STATEMENT,
        description: 'One falsifiable sentence naming the structure, the quantity and the direction of the claim.',
      },
      feature_predicate: hoist(schema.predicate, 'predicate__', defs),
      prediction: {
        type: 'object',
        properties: {
          quantity: { type: 'string', enum: quantityKeys },
          op: { type: 'string', enum: [...PREDICATE_OPS] },
          value: { type: ['number', 'string'] },
        },
        required: ['quantity', 'op', 'value'],
      },
      test_family: hoist(schema.families, 'families__', defs),
      n_range: {
        type: 'array',
        items: { type: 'integer', minimum: 2, maximum: MAX_N_QUBITS },
        minItems: 2,
        maxItems: 2,
        description: `[n_min, n_max], n_max at most ${MAX_N_QUBITS}.`,
      },
      circuits: { type: 'integer', minimum: CIRCUITS_RANGE[0], maximum: CIRCUITS_RANGE[1] },
      points: { type: 'integer', minimum: POINTS_RANGE[0], maximum: POINTS_RANGE[1] },
    },
    required: ['id', 'statement', 'feature_predicate', 'prediction', 'test_family', 'n_range', 'circuits', 'points'],
  };
}

/** The forced tool: 1 to 5 conjectures whose shape mirrors the kernel schema. */
export function buildProposeTool(schema: ConjectureSchemaInfo): ProposeTool {
  const defs: Record<string, unknown> = {};
  const item = buildConjectureItemSchema(schema, defs);
  const featureLines = schema.features.map((f) => `${f.key} (${f.type}): ${f.description}`).join('\n');
  const quantityLines = schema.quantities.map((q) => (q.description ? `${q.key}: ${q.description}` : q.key)).join('\n');
  return {
    name: PROPOSE_TOOL_NAME,
    description: [
      `Propose 1 to ${MAX_CONJECTURES} falsifiable conjectures about which circuit structures stay trainable.`,
      'Each one is tested by the kernel on NEW circuits drawn from test_family, so test_family must realise feature_predicate.',
      `Features available to feature_predicate:\n${featureLines}`,
      `Quantities available to prediction:\n${quantityLines}`,
    ].join('\n\n'),
    input_schema: {
      type: 'object',
      properties: { conjectures: { type: 'array', minItems: 1, maxItems: MAX_CONJECTURES, items: item } },
      required: ['conjectures'],
      ...(Object.keys(defs).length > 0 ? { $defs: defs } : {}),
    },
  };
}
