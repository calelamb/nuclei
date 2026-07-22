import { z } from 'zod';

import type { ResearchSelection } from './qecSelection';

export const QEC_DATA_SCHEMA_VERSION = '1.0.0' as const;
export const QEC_TILE_MAX_BYTES = 1024 * 1024;

const nonEmptyString = z.string().min(1);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);

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
const qualifiedNumberSchema = qualifiedSchema(z.number());
const qualifiedCountSchema = qualifiedSchema(z.number().int().nonnegative());
const qualifiedTimestampSchema = qualifiedSchema(z.iso.datetime({ offset: true }));

export const qecSessionSchema = z.strictObject({
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
export type QecSession = z.infer<typeof qecSessionSchema>;

export const packedBitsSchema = z.strictObject({
  encoding: z.literal('base64'),
  bit_width: z.number().int().positive(),
  data: base64,
});

const indexRangeSchema = z.strictObject({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
}).refine(({ start, end }) => end > start, 'range must be non-empty');

const qualifiedRangeSchema = qualifiedSchema(indexRangeSchema);
const qualifiedPackedBitsSchema = qualifiedSchema(packedBitsSchema);
const timestampSeriesSchema = z.strictObject({
  values: z.array(z.number()),
  unit: nonEmptyString,
});
const qualifiedTimestampsSchema = qualifiedSchema(timestampSeriesSchema);

export const syndromeBatchSchema = z.strictObject({
  schema_version: z.literal(QEC_DATA_SCHEMA_VERSION),
  batch_id: nonEmptyString,
  session_id: nonEmptyString,
  segment_id: nonEmptyString,
  sequence_start: z.number().int().nonnegative(),
  sequence_end: z.number().int().positive(),
  record_count: z.number().int().positive(),
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
  ])).refine((values) => new Set(values).size === values.length),
  provenance_id: nonEmptyString,
}).superRefine((batch, context) => {
  if (batch.sequence_end - batch.sequence_start !== batch.record_count) {
    context.addIssue({
      code: 'custom',
      path: ['sequence_end'],
      message: 'sequence range must equal record_count',
    });
  }
});
export type QecSyndromeBatch = z.infer<typeof syndromeBatchSchema>;

const decoderSchema = z.strictObject({
  name: nonEmptyString,
  version: nonEmptyString,
  configuration_sha256: sha256,
});
const correctionSchema = z.union([
  z.strictObject({
    edge_ids: z.array(nonEmptyString).refine((values) => new Set(values).size === values.length),
  }),
  z.strictObject({ compact_ref: nonEmptyString }),
]);
const qualifiedCorrectionSchema = qualifiedSchema(correctionSchema);
const qualifiedQuantitySchema = z.strictObject({
  value: z.number().nonnegative().nullable(),
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
    sequence_start: z.number().int().nonnegative(),
    sequence_end: z.number().int().positive(),
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
});
export type QecDecodeResult = z.infer<typeof decodeResultSchema>;

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
  original_representation: z.strictObject({ mime_type: nonEmptyString, value: z.string() }),
  provenance_id: nonEmptyString,
});
export type QecCalibrationRecord = z.infer<typeof calibrationRecordSchema>;

const scalarParameterSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
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
  })).min(1),
  adapter: adapterIdentitySchema,
  mapping_decisions: z.array(decisionSchema),
  unit_conversions: z.array(z.strictObject({
    field: nonEmptyString,
    source_unit: nonEmptyString,
    canonical_unit: nonEmptyString,
    factor: z.number(),
    offset: z.number(),
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
export type QecProvenanceRecord = z.infer<typeof provenanceRecordSchema>;

export const qecSessionSummarySchema = qecSessionSchema.pick({
  session_id: true,
  kind: true,
  status: true,
  created_at: true,
  completed_at: true,
  adapter: true,
  counts: true,
  provenance_id: true,
});
export type QecSessionSummary = z.infer<typeof qecSessionSummarySchema>;

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
  }),
  filters: z.record(z.string(), queryFilterValueSchema),
});
export type QecQuerySpec = z.infer<typeof qecQuerySpecSchema>;

export const qecTilePayloadSchema = z.strictObject({
  kind: qecTileKindSchema,
  datasetId: nonEmptyString,
  sequence: z.number().int().nonnegative(),
  content: z.json(),
  byteLength: z.number().int().nonnegative().max(QEC_TILE_MAX_BYTES),
});
export type QecTilePayload = z.infer<typeof qecTilePayloadSchema>;

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
export type QecQueryResult = z.infer<typeof qecQueryResultSchema>;
