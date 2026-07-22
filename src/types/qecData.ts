import { z } from 'zod';

import type { ResearchSelection } from './qecSelection';

export const QEC_DATA_SCHEMA_VERSION = '1.0.0' as const;
export const QEC_TILE_MAX_BYTES = 1024 * 1024;

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

const nonEmptyString = z.string().min(1);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const canonicalBase64 = z.string().regex(
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
);
const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const qecValueStatusSchema = z.enum([
  'absent',
  'unavailable',
  'unknown',
  'inferred',
  'predicted',
  'simulated',
  'measured',
]);
export type QecValueStatus = z.infer<typeof qecValueStatusSchema>;

const nullStatuses: ReadonlySet<QecValueStatus> = new Set([
  'absent',
  'unavailable',
  'unknown',
]);

function enforceQualifiedValue(
  value: unknown,
  status: QecValueStatus,
  context: z.RefinementCtx,
): void {
  if (nullStatuses.has(status) !== (value === null)) {
    context.addIssue({
      code: 'custom',
      path: ['value'],
      message: `${status} status and value presence disagree`,
    });
  }
}

function qualifiedSchema<Output, Input>(valueSchema: z.ZodType<Output, Input>) {
  const schema = z.strictObject({
    value: valueSchema.nullable(),
    status: qecValueStatusSchema,
  });
  return schema.superRefine((qualified, context) => {
    const value: unknown = qualified.value;
    enforceQualifiedValue(value, qualified.status, context);
  });
}

export const adapterIdentitySchema = z.strictObject({
  id: nonEmptyString,
  version: nonEmptyString,
});

const qualifiedTextSchema = qualifiedSchema(nonEmptyString);
const qualifiedNumberSchema = qualifiedSchema(z.number().finite());
const qualifiedCountSchema = qualifiedSchema(safeInteger);
const qualifiedTimestampSchema = qualifiedSchema(z.iso.datetime({ offset: true }));

const qecSessionObjectSchema = z.strictObject({
  schema_version: z.literal(QEC_DATA_SCHEMA_VERSION),
  session_id: nonEmptyString,
  kind: z.enum(['simulation_campaign', 'hardware_import', 'hardware_live', 'replay']),
  status: z.enum(['created', 'importing', 'recording', 'complete', 'partial', 'failed']),
  created_at: z.iso.datetime({ offset: true }),
  started_at: qualifiedTimestampSchema,
  completed_at: qualifiedTimestampSchema,
  adapter: adapterIdentitySchema,
  references: z.strictObject({
    circuit: qualifiedTextSchema,
    detector_error_model: qualifiedTextSchema,
    topology: qualifiedTextSchema,
    calibration: qualifiedTextSchema,
  }),
  counts: z.strictObject({
    detectors: qualifiedCountSchema,
    observables: qualifiedCountSchema,
    measurements: qualifiedCountSchema,
    logical_patches: qualifiedCountSchema,
  }),
  source_clock: z.strictObject({
    identity: qualifiedTextSchema,
    description: z.string(),
  }),
  timebase: z.strictObject({
    domain: z.enum(['tick', 'round', 'timestamp', 'custom']),
    unit: qualifiedTextSchema,
    tick_period: qualifiedNumberSchema,
    description: z.string(),
  }),
  provenance_id: nonEmptyString,
  segments: z.array(nonEmptyString).refine((values) => new Set(values).size === values.length),
});

export const qecSessionSchema = qecSessionObjectSchema.superRefine((session, context) => {
  const started = session.started_at.value !== null;
  const completed = session.completed_at.value !== null;
  const invalid =
    (session.status === 'created' && (
      started || completed || session.started_at.status !== 'absent' || session.completed_at.status !== 'absent'
    )) ||
    (['importing', 'recording'].includes(session.status) && (
      !started || completed || session.completed_at.status !== 'absent'
    )) ||
    (['complete', 'partial'].includes(session.status) && (!started || !completed)) ||
    (session.status === 'failed' && !completed);
  if (invalid) context.addIssue({ code: 'custom', path: ['status'], message: 'session lifecycle and timestamps disagree' });
});
export type QecSession = DeepReadonly<z.infer<typeof qecSessionSchema>>;

function decodeCanonicalBase64(data: string): Uint8Array | null {
  try {
    const decoded = atob(data);
    if (btoa(decoded) !== data) return null;
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function validatePackedBits(
  packed: { bit_width: number; data: string },
  context: z.RefinementCtx,
): void {
  const bytes = decodeCanonicalBase64(packed.data);
  if (!bytes) {
    context.addIssue({ code: 'custom', path: ['data'], message: 'data must be canonical base64' });
    return;
  }
  const bytesPerRecord = Math.ceil(packed.bit_width / 8);
  if (bytes.length === 0 || bytes.length % bytesPerRecord !== 0) {
    context.addIssue({ code: 'custom', path: ['data'], message: 'decoded data must contain complete rows' });
    return;
  }
  const remainder = packed.bit_width % 8;
  if (remainder === 0) return;
  const highMask = 0xff ^ ((1 << remainder) - 1);
  for (let index = bytesPerRecord - 1; index < bytes.length; index += bytesPerRecord) {
    if ((bytes[index] & highMask) !== 0) {
      context.addIssue({ code: 'custom', path: ['data'], message: 'unused LSB0 high padding bits must be zero' });
      return;
    }
  }
}

export const packedBitsSchema = z.strictObject({
  encoding: z.literal('base64'),
  bit_order: z.literal('lsb0'),
  bit_width: safeInteger.min(1),
  data: canonicalBase64,
}).superRefine(validatePackedBits);

const indexRangeSchema = z.strictObject({
  start: safeInteger,
  end: safeInteger.min(1),
}).refine(({ start, end }) => end > start, 'range must be non-empty');

const qualifiedRangeSchema = qualifiedSchema(indexRangeSchema);
const qualifiedPackedBitsSchema = qualifiedSchema(packedBitsSchema);
const timestampSeriesSchema = z.strictObject({
  values: z.array(z.number().finite()),
  unit: nonEmptyString,
});
const qualifiedTimestampsSchema = qualifiedSchema(timestampSeriesSchema);

export const syndromeBatchSchema = z.strictObject({
  schema_version: z.literal(QEC_DATA_SCHEMA_VERSION),
  batch_id: nonEmptyString,
  session_id: nonEmptyString,
  segment_id: nonEmptyString,
  sequence_start: safeInteger,
  sequence_end: safeInteger.min(1),
  record_count: safeInteger.min(1),
  shot_range: qualifiedRangeSchema,
  round_range: qualifiedRangeSchema,
  source_timestamps: qualifiedTimestampsSchema,
  detector_events: packedBitsSchema,
  measurements: qualifiedPackedBitsSchema,
  observables: qualifiedPackedBitsSchema,
  erasures: qualifiedPackedBitsSchema,
  leakage: qualifiedPackedBitsSchema,
  heralds: qualifiedPackedBitsSchema,
  circuit_revision: qualifiedTextSchema,
  topology_revision: qualifiedTextSchema,
  data_quality: z.array(z.enum([
    'complete',
    'partial',
    'out_of_order',
    'duplicate',
    'gap_before',
    'clock_unreliable',
    'vendor_flagged',
  ])).min(1).refine((values) => new Set(values).size === values.length)
    .refine((values) => !values.includes('complete') || values.length === 1),
  provenance_id: nonEmptyString,
}).superRefine((batch, context) => {
  if (batch.sequence_end - batch.sequence_start !== batch.record_count) {
    context.addIssue({
      code: 'custom',
      path: ['sequence_end'],
      message: 'sequence range must equal record_count',
    });
  }
  const validateRows = (packed: z.infer<typeof packedBitsSchema>, path: string): void => {
    const bytes = decodeCanonicalBase64(packed.data);
    const rowCount = bytes ? bytes.length / Math.ceil(packed.bit_width / 8) : -1;
    if (rowCount !== batch.record_count) {
      context.addIssue({ code: 'custom', path: [path, 'data'], message: 'decoded rows must equal record_count' });
    }
  };
  validateRows(batch.detector_events, 'detector_events');
  for (const path of ['measurements', 'observables', 'erasures', 'leakage', 'heralds'] as const) {
    const packed = batch[path].value;
    if (packed) validateRows(packed, path);
  }
  if (batch.source_timestamps.value && batch.source_timestamps.value.values.length !== batch.record_count) {
    context.addIssue({ code: 'custom', path: ['source_timestamps', 'value', 'values'], message: 'timestamps must equal record_count' });
  }
});
export type QecSyndromeBatch = DeepReadonly<z.infer<typeof syndromeBatchSchema>>;

const decoderSchema = z.strictObject({
  name: nonEmptyString,
  version: nonEmptyString,
  configuration_sha256: sha256,
});
const correctionSchema = z.union([
  z.strictObject({
    kind: z.literal('edge_ids'),
    edge_ids: z.array(nonEmptyString).min(1).refine((values) => new Set(values).size === values.length),
  }),
  z.strictObject({ kind: z.literal('compact_ref'), compact_ref: nonEmptyString }),
]);
const qualifiedCorrectionSchema = qualifiedSchema(correctionSchema);
const qualifiedQuantitySchema = z.strictObject({
  value: z.number().finite().nonnegative().nullable(),
  unit: nonEmptyString.nullable(),
  status: qecValueStatusSchema,
}).superRefine(({ value, unit, status }, context) => {
  enforceQualifiedValue(value, status, context);
  if ((value === null) !== (unit === null)) {
    context.addIssue({ code: 'custom', path: ['unit'], message: 'unit must accompany a value' });
  }
});

export const decodeResultSchema = z.strictObject({
  schema_version: z.literal(QEC_DATA_SCHEMA_VERSION),
  decode_id: nonEmptyString,
  session_id: nonEmptyString,
  input: z.strictObject({
    batch_id: nonEmptyString,
    sequence_start: safeInteger,
    sequence_end: safeInteger.min(1),
  }).refine(({ sequence_start, sequence_end }) => sequence_end > sequence_start),
  decoder: decoderSchema,
  status: z.enum(['complete', 'partial', 'timeout', 'error']),
  prediction: packedBitsSchema,
  confidence: qualifiedNumberSchema,
  correction: qualifiedCorrectionSchema,
  predicted_logical_flips: packedBitsSchema,
  known_truth: qualifiedPackedBitsSchema,
  pipeline_latency: qualifiedQuantitySchema,
  total_latency: qualifiedQuantitySchema,
  error: z.strictObject({ code: nonEmptyString, message: nonEmptyString }).nullable(),
  provenance_id: nonEmptyString,
}).superRefine((decode, context) => {
  const failed = decode.status === 'error' || decode.status === 'timeout';
  if (failed !== (decode.error !== null)) {
    context.addIssue({ code: 'custom', path: ['error'], message: 'error must exist exactly for error or timeout status' });
  }
  const recordCount = decode.input.sequence_end - decode.input.sequence_start;
  const validateRows = (packed: z.infer<typeof packedBitsSchema>, path: string): void => {
    const bytes = decodeCanonicalBase64(packed.data);
    const rows = bytes ? bytes.length / Math.ceil(packed.bit_width / 8) : -1;
    if (rows !== recordCount) context.addIssue({ code: 'custom', path: [path, 'data'], message: 'decoded rows must match input range' });
  };
  validateRows(decode.prediction, 'prediction');
  validateRows(decode.predicted_logical_flips, 'predicted_logical_flips');
  if (decode.known_truth.value) validateRows(decode.known_truth.value, 'known_truth');
});
export type QecDecodeResult = DeepReadonly<z.infer<typeof decodeResultSchema>>;

export const calibrationRecordSchema = z.strictObject({
  schema_version: z.literal(QEC_DATA_SCHEMA_VERSION),
  calibration_id: nonEmptyString,
  session_id: nonEmptyString,
  effective_interval: z.strictObject({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }).nullable(),
  }),
  scope: z.strictObject({
    kind: z.enum(['device', 'patch', 'qubit', 'coupler', 'resonator', 'readout_channel', 'custom']),
    id: nonEmptyString,
  }),
  parameter: z.strictObject({ name: nonEmptyString, semantic_id: nonEmptyString }),
  value: qualifiedNumberSchema,
  unit: qualifiedTextSchema,
  uncertainty: qualifiedNumberSchema,
  quality: z.enum(['accepted', 'suspect', 'rejected', 'unknown']),
  source_system: nonEmptyString,
  calibration_run_id: nonEmptyString.nullable(),
  original_representation: z.strictObject({ mime_type: z.string().regex(/^[^\s/]+\/[^\s/]+$/), value: z.string() }),
  provenance_id: nonEmptyString,
}).superRefine((record, context) => {
  if (record.effective_interval.end !== null) {
    const start = Date.parse(record.effective_interval.start);
    const end = Date.parse(record.effective_interval.end);
    if (end < start) context.addIssue({ code: 'custom', path: ['effective_interval', 'end'], message: 'end cannot precede start' });
  }
});
export type QecCalibrationRecord = DeepReadonly<z.infer<typeof calibrationRecordSchema>>;

const scalarParameterSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const decisionSchema = z.strictObject({
  field: nonEmptyString,
  decision: nonEmptyString,
  reason: z.string(),
});
const referenceSchema = z.strictObject({ kind: nonEmptyString, id: nonEmptyString });
const operationSchema = z.strictObject({
  id: nonEmptyString,
  version: nonEmptyString,
  parameters: z.record(z.string(), scalarParameterSchema),
});

export const provenanceRecordSchema = z.strictObject({
  schema_version: z.literal(QEC_DATA_SCHEMA_VERSION),
  provenance_id: nonEmptyString,
  created_at: z.iso.datetime({ offset: true }),
  sources: z.array(z.strictObject({
    source_id: nonEmptyString,
    uri: nonEmptyString,
    sha256,
    policy: z.enum(['copy', 'reference']),
  })).min(1).refine((sources) => new Set(sources.map((source) => source.source_id)).size === sources.length),
  adapter: adapterIdentitySchema,
  mapping_decisions: z.array(decisionSchema),
  unit_conversions: z.array(z.strictObject({
    field: nonEmptyString,
    source_unit: nonEmptyString,
    canonical_unit: nonEmptyString,
    factor: z.number().finite(),
    offset: z.number().finite(),
  })),
  revision_references: z.array(referenceSchema),
  environment: z.strictObject({
    runtime: nonEmptyString,
    runtime_version: nonEmptyString,
    dependencies: z.record(z.string(), nonEmptyString),
  }),
  parent_dataset_ids: z.array(nonEmptyString).refine((values) => new Set(values).size === values.length),
  transformations: z.array(operationSchema),
  filters: z.array(decisionSchema),
  exclusions: z.array(decisionSchema),
  recipes: z.array(operationSchema),
  annotations: z.array(referenceSchema),
  control_audit_refs: z.array(nonEmptyString).refine((values) => new Set(values).size === values.length),
});
export type QecProvenanceRecord = DeepReadonly<z.infer<typeof provenanceRecordSchema>>;

export const qecSessionSummarySchema = qecSessionObjectSchema.pick({
  session_id: true,
  kind: true,
  status: true,
  created_at: true,
  completed_at: true,
  adapter: true,
  counts: true,
  provenance_id: true,
});
export type QecSessionSummary = DeepReadonly<z.infer<typeof qecSessionSummarySchema>>;

export const qecTileKindSchema = z.enum([
  'time-series',
  'heatmap',
  'histogram',
  'graph-overlay',
  'shot-window',
  'table-page',
]);
export type QecTileKind = z.infer<typeof qecTileKindSchema>;

const qecEntityRefSchema = z.strictObject({
  kind: z.enum([
    'study', 'source', 'session', 'dataset', 'circuit-revision', 'tick', 'qubit',
    'stabilizer', 'detector', 'edge', 'logical-observable', 'campaign-point',
    'decoder', 'shot', 'round', 'time-window', 'calibration-record', 'cohort',
    'alert', 'finding',
  ]),
  id: nonEmptyString,
  sessionId: nonEmptyString.optional(),
  datasetId: nonEmptyString.optional(),
});

const researchSelectionSchema: z.ZodType<ResearchSelection> = z.strictObject({
  primary: qecEntityRefSchema.nullable(),
  scope: z.array(qecEntityRefSchema),
  timeWindow: z.strictObject({
    start: z.number(),
    end: z.number(),
    domain: z.enum(['tick', 'round', 'ns']),
  }).refine(({ start, end }) => end >= start).nullable(),
  source: z.enum(['user', 'panel', 'alert', 'dirac', 'restore']),
});

const queryFilterValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
export const qecQuerySpecSchema = z.strictObject({
  requestId: nonEmptyString,
  sessionId: nonEmptyString,
  datasetId: nonEmptyString,
  tile: qecTileKindSchema,
  selection: researchSelectionSchema,
  resolution: z.strictObject({
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
  }).readonly(),
  filters: z.record(z.string(), queryFilterValueSchema).readonly(),
}).readonly();
export type QecQuerySpec = DeepReadonly<z.infer<typeof qecQuerySpecSchema>>;

/** UTF-8 JSON bytes for content alone; retained for callers displaying content size. */
export function qecTileContentByteLength(content: unknown): number {
  const serialized = JSON.stringify(content);
  if (serialized === undefined) throw new TypeError('tile content must be JSON serializable');
  return new TextEncoder().encode(serialized).byteLength;
}

/**
 * Normative tile size: UTF-8 JSON bytes for the complete tile object with the
 * self-referential `byteLength` field omitted. Task 5 also caps the final result
 * envelope and Task 8 caps every complete WebSocket frame.
 */
export function qecTilePayloadByteLength(payload: unknown): number {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new TypeError('tile payload must be an object');
  }
  const normalized = Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== 'byteLength'),
  );
  const serialized = JSON.stringify(normalized);
  if (serialized === undefined) throw new TypeError('tile payload must be JSON serializable');
  return new TextEncoder().encode(serialized).byteLength;
}

export const qecTilePayloadSchema = z.strictObject({
  kind: qecTileKindSchema,
  datasetId: nonEmptyString,
  sequence: safeInteger,
  content: z.json(),
  byteLength: z.number().int().nonnegative().max(QEC_TILE_MAX_BYTES),
}).superRefine((tile, context) => {
  const actual = qecTilePayloadByteLength(tile);
  if (tile.byteLength !== actual) {
    context.addIssue({ code: 'custom', path: ['byteLength'], message: 'byteLength must equal normalized UTF-8 tile payload bytes' });
  }
}).readonly();
export type QecTilePayload = DeepReadonly<z.infer<typeof qecTilePayloadSchema>>;

export const qecQueryResultSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('progress'),
    requestId: nonEmptyString,
    fraction: z.number().min(0).max(1),
    message: z.string(),
  }),
  z.strictObject({
    type: z.literal('tile'),
    requestId: nonEmptyString,
    tile: qecTilePayloadSchema,
    complete: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('error'),
    requestId: nonEmptyString,
    code: nonEmptyString,
    message: nonEmptyString,
  }),
]);
export type QecQueryResult = DeepReadonly<z.infer<typeof qecQueryResultSchema>>;
