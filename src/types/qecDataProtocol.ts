import { z } from 'zod';

import {
  qecQuerySpecSchema,
  qecSessionSchema,
  qecTilePayloadSchema,
  type DeepReadonly,
  type QecQueryResult,
  type QecQuerySpec,
} from './qecData';

export const QEC_DATA_URL = 'ws://127.0.0.1:9743' as const;
export const QEC_DATA_MAX_FRAME_BYTES = 1024 * 1024;

const text = z.string().min(1).max(4096);
const requestId = z.string().min(1).max(256);
const safeCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const scalar = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

export type ImportOption = z.infer<typeof scalar> | readonly ImportOption[];
const importOptionSchema: z.ZodType<ImportOption> = z.lazy(() =>
  z.union([scalar, z.array(importOptionSchema)]),
);

export const qecDataEndpointSchema = z.strictObject({
  url: z.literal(QEC_DATA_URL),
  token: z.string().min(1).max(1024),
}).readonly();
export type QecDataEndpoint = z.infer<typeof qecDataEndpointSchema>;

export const projectRelativeSourceSchema = text.superRefine((value, context) => {
  const parts = value.split('/');
  const forbidden = value.startsWith('/') || value.includes('\\')
    || parts.some((part) => part === '' || part === '.' || part === '..')
    || parts[0] === 'qec-data';
  if (forbidden) context.addIssue({ code: 'custom', message: 'Source must be a project-relative non-canonical path.' });
});

export const importMappingSchema = z.strictObject({
  fields: z.record(z.string().min(1), z.string().min(1)),
  options: z.record(z.string().min(1), importOptionSchema),
  expectedProvenanceId: text.optional(),
}).readonly();
export type ImportMapping = DeepReadonly<z.infer<typeof importMappingSchema>>;

const copyPolicy = z.literal('copy');
const probeAdapterSchema = z.strictObject({
  adapterId: text,
  adapterVersion: text,
  supported: z.boolean(),
  sourceKind: text.nullable(),
  confidence: z.number().min(0).max(1),
  sourceSha256: sha256.nullable(),
  details: z.record(z.string(), scalar),
}).readonly();

export const importProbeResultSchema = z.strictObject({
  type: z.literal('import_probe_result'), requestId,
  results: z.array(probeAdapterSchema), sourceByteSize: safeCount, sourcePolicy: copyPolicy,
}).readonly();
export type ImportProbeResult = DeepReadonly<z.infer<typeof importProbeResultSchema>>;

const validationIssueSchema = z.strictObject({
  code: text, message: text, severity: z.enum(['error', 'warning']), field: text.nullable(),
}).readonly();
export const importValidationResultSchema = z.strictObject({
  type: z.literal('import_validation_result'), requestId, valid: z.boolean(),
  issues: z.array(validationIssueSchema), sourceSha256: sha256.nullable(),
  provenanceId: text.nullable(), sourceByteSize: safeCount, sourcePolicy: copyPolicy,
}).readonly();
export type ImportValidationResult = DeepReadonly<z.infer<typeof importValidationResultSchema>>;

const previewBatchSchema = z.strictObject({
  recordKind: text, recordCount: safeCount, sequenceStart: safeCount,
  sequenceEnd: safeCount, segmentId: text,
}).readonly();
export const importPreviewResultSchema = z.strictObject({
  type: z.literal('import_preview_result'), requestId, batches: z.array(previewBatchSchema),
  truncated: z.boolean(), totalRecords: safeCount.nullable(), sourceSha256: sha256.nullable(),
  provenanceId: text.nullable(),
}).readonly();
export type ImportPreviewResult = DeepReadonly<z.infer<typeof importPreviewResultSchema>>;

const jobStartedSchema = z.strictObject({
  type: z.literal('job_started'), requestId, jobId: requestId,
  jobKind: z.enum(['import', 'query']), sourcePolicy: copyPolicy.optional(),
}).readonly();
const importJobCompleteSchema = z.strictObject({
  type: z.literal('job_complete'), requestId, jobId: requestId,
  recordsWritten: safeCount, partitionsWritten: safeCount, sourcePolicy: copyPolicy,
}).readonly();
export type ImportJobComplete = DeepReadonly<z.infer<typeof importJobCompleteSchema>>;
export type ImportJobEvent = DeepReadonly<
  z.infer<typeof jobStartedSchema> | z.infer<typeof importJobCompleteSchema>
>;

const jobCancelledSchema = z.strictObject({
  type: z.literal('job_cancelled'), requestId, jobId: requestId, success: z.boolean(),
}).readonly();
const queryCancelledSchema = z.strictObject({
  type: z.literal('query_cancelled'), requestId, queryRequestId: requestId, success: z.boolean(),
}).readonly();

const queryProgressSchema = z.strictObject({
  type: z.literal('progress'), requestId, fraction: z.number().min(0).max(1), message: z.string(),
}).readonly();
const queryTileSchema = z.strictObject({
  type: z.literal('tile'), requestId, tile: qecTilePayloadSchema, complete: z.boolean(),
}).readonly();
const errorSchema = z.strictObject({
  type: z.literal('error'), requestId: requestId.optional(), code: text, message: text,
}).readonly();
export type QecDataErrorFrame = DeepReadonly<z.infer<typeof errorSchema>>;

const sessionListResultSchema = z.strictObject({
  type: z.literal('session_list_result'), requestId,
  sessions: z.array(qecSessionSchema), nextCursor: text.nullable(),
}).readonly();

export const qecDataInboundFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('authenticated') }).readonly(),
  importProbeResultSchema,
  importValidationResultSchema,
  importPreviewResultSchema,
  jobStartedSchema,
  importJobCompleteSchema,
  jobCancelledSchema,
  queryCancelledSchema,
  queryProgressSchema,
  queryTileSchema,
  sessionListResultSchema,
  errorSchema,
]);
export type QecDataInboundFrame = DeepReadonly<z.infer<typeof qecDataInboundFrameSchema>>;

export interface ImportStartInput {
  source: string;
  adapterId: string;
  mapping: ImportMapping;
  sessionId: string;
  sessionKind: 'simulation_campaign' | 'hardware_import' | 'hardware_live' | 'replay';
}

export interface ImportRequestInput {
  source: string;
  adapterId: string;
  mapping: ImportMapping;
}

export type QueryFrame = Extract<QecQueryResult, { type: 'progress' | 'tile' }>;
export type ValidQecQuerySpec = QecQuerySpec;
export const outboundQuerySchema = qecQuerySpecSchema;
