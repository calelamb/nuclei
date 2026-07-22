import { parse, stringify } from 'yaml';
import { z } from 'zod';

export const qecWorkspacePresetSchema = z.enum(['build', 'analyze', 'observe']);
export type QecWorkspacePreset = z.infer<typeof qecWorkspacePresetSchema>;

const projectPath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.startsWith('\\') &&
      !/^[a-zA-Z]:/.test(value) &&
      !value.split(/[\\/]/).includes('..'),
    'path must stay inside the project',
  );

const qecStudySourceSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(['stim', 'python', 'dem', 'experiment', 'noise', 'session']),
  path: projectPath,
});

export type QecStudySource = z.infer<typeof qecStudySourceSchema>;

export const qecStudySchema = z.strictObject({
  schema: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  question: z.string().min(1),
  preset: qecWorkspacePresetSchema,
  tags: z.array(z.string()).default([]),
  sources: z.array(qecStudySourceSchema),
});

export type QecStudy = z.infer<typeof qecStudySchema>;

export type QecStudyParse =
  | { ok: true; study: QecStudy }
  | { ok: false; errors: string[] };

function issueMessage(issue: z.core.$ZodIssue): string {
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Parse and validate an untrusted schema-1 QEC Study YAML document. */
export function parseQecStudyYaml(text: string): QecStudyParse {
  try {
    const result = qecStudySchema.safeParse(parse(text));
    return result.success
      ? { ok: true, study: result.data }
      : { ok: false, errors: result.error.issues.map(issueMessage) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`YAML parse error: ${message}`] };
  }
}

/** Serialize a validated Study into its versioned YAML representation. */
export function serializeQecStudy(study: QecStudy): string {
  return stringify(qecStudySchema.parse(study), { lineWidth: 100 });
}
