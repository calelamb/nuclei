import { z } from 'zod';

/**
 * `qec_explain_result` payload (kernel/qec/explain_handler.py). Parsed with
 * zod at the WebSocket boundary: a malformed reply becomes a visible error in
 * the panel, never a half-rendered explanation.
 */
const lineRef = z.number().int().positive().nullish();

const operationSchema = z.looseObject({
  description: z.string().nullish(),
  qubits: z.array(z.number().int()).default([]),
  instruction: z.string().nullish(),
});

const causeSchema = z.looseObject({
  kind: z.enum(['preparation_basis_mismatch', 'measurement_basis_mismatch']),
  basis: z.string(),
  operation_line: lineRef,
  preparation_line: lineRef,
  detector_lines: z.record(z.string(), z.number().int().positive()).default({}),
});

const sensitivitySchema = z.looseObject({ target: z.string(), pauli: z.string() });

export const nondeterministicSchema = z.looseObject({
  status: z.enum(['ok', 'nondeterministic', 'invalid_circuit', 'parse_error']),
  sentence: z.string(),
  kind: z.string().nullish(),
  line: lineRef,
  line_text: z.string().nullish(),
  tick: z.number().int().nonnegative().nullish(),
  detector_indices: z.array(z.number().int()).default([]),
  observable_indices: z.array(z.number().int()).default([]),
  operation: operationSchema.nullish(),
  sensitivity: z.string().nullish(),
  diagram_svg: z.string().nullish(),
  stim_message: z.string().nullish(),
  targets: z.array(z.string()).default([]),
  /** Total flagged detectors/observables; `targets` is bounded by the kernel. */
  target_count: z.number().int().nonnegative().nullish(),
  targets_omitted: z.number().int().nonnegative().default(0),
  sensitivities: z.array(sensitivitySchema).default([]),
  /** Set when Stim blamed a reset/measurement but the real cause is a basis mismatch. */
  cause: causeSchema.nullish(),
  /** Line declaring each named detector/observable ("D0" / "L0"): usually the real cause. */
  declaration_lines: z.record(z.string(), z.number().int().positive()).default({}),
});

export const faultSchema = z.looseObject({
  index: z.number().int(),
  located: z.boolean(),
  tick: z.number().int().nullish(),
  qubits: z.array(z.number().int()).default([]),
  gate: z.string().nullish(),
  instruction: z.string().nullish(),
  pauli: z.string().nullish(),
  line: lineRef,
  line_text: z.string().nullish(),
  iteration: z.number().int().nonnegative().nullish(),
  detectors: z.array(z.string()).default([]),
  observables: z.array(z.string()).default([]),
});

export const minWeightSchema = z.looseObject({
  status: z.enum(['ok', 'none_found', 'nondeterministic', 'invalid_circuit', 'parse_error']),
  sentence: z.string(),
  method: z.string().nullish(),
  weight: z.number().int().nonnegative().nullish(),
  weight_is_upper_bound: z.boolean().nullish(),
  caveat: z.string().nullish(),
  num_detectors: z.number().int().nullish(),
  num_observables: z.number().int().nullish(),
  faults: z.array(faultSchema).default([]),
});

export const qecExplainDataSchema = z.looseObject({
  nondeterministic: nondeterministicSchema.optional(),
  min_weight: minWeightSchema.optional(),
});

export type QecNondeterministic = z.infer<typeof nondeterministicSchema>;
export type QecFault = z.infer<typeof faultSchema>;
export type QecMinWeight = z.infer<typeof minWeightSchema>;
export type QecExplainData = z.infer<typeof qecExplainDataSchema>;

export type ParsedExplain =
  | { ok: true; data: QecExplainData }
  | { ok: false; error: string };

export function parseQecExplainData(raw: unknown): ParsedExplain {
  const parsed = qecExplainDataSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const first = parsed.error.issues[0];
  const where = first?.path.length ? ` at ${first.path.join('.')}` : '';
  return { ok: false, error: `The kernel's explanation was malformed${where}: ${first?.message ?? 'unknown'}.` };
}
