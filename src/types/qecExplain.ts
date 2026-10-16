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
