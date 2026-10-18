/**
 * SEARCH/REPLACE edit application for LLM proposals (PRD 14 §7.4).
 *
 * The contract protects the trusted harness around the evolved code:
 * - each `search` must match the program exactly once, and the match must lie
 *   fully inside the `# EVOLVE-BLOCK-START` / `# EVOLVE-BLOCK-END` region;
 * - no edit may mention a marker, so the region can never be moved or removed;
 * - all edits are matched against the ORIGINAL program and must not overlap,
 *   so edit order never changes the meaning of a proposal;
 * - applying an edit whose result is already present is rejected as
 *   `already_applied` instead of being applied twice (idempotent-safe).
 *
 * With no markers at all the whole file is the region and `regionWarning`
 * is set; a lone or duplicated marker is an error.
 */

import { EVOLVE_END_MARKER, EVOLVE_START_MARKER } from '../../types/discovery';

export interface Edit {
  search: string;
  replace: string;
}

/** 1-based inclusive line span of a match in the ORIGINAL program. */
export interface EditSpan {
  startLine: number;
  endLine: number;
}

type DiffErrorCode =
  | 'empty_search'
  | 'not_found'
  | 'ambiguous_match'
  | 'outside_region'
  | 'touches_marker'
  | 'overlapping_edits'
  | 'bad_markers'
  | 'already_applied'
  | 'no_change';

export type ApplyEditsResult =
  | { ok: true; program: string; regionWarning: boolean; spans: EditSpan[] }
  | { ok: false; code: DiffErrorCode; message: string; editIndex: number | null };

export interface Region {
  start: number;
  end: number;
  /** True when no markers exist and the whole file is the region. */
  wholeFile: boolean;
}

function markerLineOffsets(program: string, marker: string): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of program.split('\n')) {
    if (line.trim().startsWith(marker)) offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

/** Locate the editable region, or explain why the markers are unusable. */
export function findRegion(program: string): { ok: true; region: Region } | { ok: false; message: string } {
  const starts = markerLineOffsets(program, EVOLVE_START_MARKER);
  const ends = markerLineOffsets(program, EVOLVE_END_MARKER);
  if (starts.length === 0 && ends.length === 0) {
    return { ok: true, region: { start: 0, end: program.length, wholeFile: true } };
  }
  if (starts.length !== 1 || ends.length !== 1) {
    return {
      ok: false,
      message: `expected exactly one ${EVOLVE_START_MARKER} and one ${EVOLVE_END_MARKER} (found ${starts.length} and ${ends.length})`,
    };
  }
  const lineEnd = program.indexOf('\n', starts[0]);
  const regionStart = lineEnd < 0 ? program.length : lineEnd + 1;
  if (ends[0] < regionStart) {
    return { ok: false, message: `${EVOLVE_END_MARKER} must come after ${EVOLVE_START_MARKER}` };
  }
  return { ok: true, region: { start: regionStart, end: ends[0], wholeFile: false } };
}

/** Start offsets of every (possibly overlapping) occurrence of `needle`. */
export function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  let from = haystack.indexOf(needle);
  while (from >= 0) {
    found.push(from);
    from = haystack.indexOf(needle, from + 1);
  }
  return found;
}

function lineOf(program: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (program.charCodeAt(i) === 10) line += 1;
  return line;
}

function fail(code: DiffErrorCode, message: string, editIndex: number | null): ApplyEditsResult {
  return { ok: false, code, message, editIndex };
}

function mentionsMarker(text: string): boolean {
  return text.includes(EVOLVE_START_MARKER) || text.includes(EVOLVE_END_MARKER);
}

interface Match {
  start: number;
  end: number;
  replace: string;
  index: number;
}

export function applyEdits(program: string, edits: readonly Edit[]): ApplyEditsResult {
  const located = findRegion(program);
  if (!located.ok) return fail('bad_markers', located.message, null);
  const { region } = located;
  const matches: Match[] = [];

  for (let index = 0; index < edits.length; index += 1) {
    const { search, replace } = edits[index];
    const label = `edit ${index + 1}`;
    if (search.length === 0) return fail('empty_search', `${label}: search text is empty`, index);
    if (mentionsMarker(search) || mentionsMarker(replace)) {
      return fail('touches_marker', `${label}: edits must not include the EVOLVE-BLOCK markers`, index);
    }
    const found = occurrences(program, search);
    if (found.length === 0) {
      const alreadyThere = occurrences(program.slice(region.start, region.end), replace).length > 0;
      return alreadyThere && replace.length > 0
        ? fail('already_applied', `${label}: search text not found but the replacement is already present`, index)
        : fail('not_found', `${label}: search text does not match the program exactly`, index);
    }
    if (found.length > 1) {
      return fail('ambiguous_match', `${label}: search text matches ${found.length} places; it must match exactly once`, index);
    }
    const start = found[0];
    const end = start + search.length;
    if (start < region.start || end > region.end) {
      return fail('outside_region', `${label}: search text lies outside the EVOLVE-BLOCK region`, index);
    }
    matches.push({ start, end, replace, index });
  }

  const ordered = [...matches].sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].start < ordered[i - 1].end) {
      return fail('overlapping_edits', `edits ${ordered[i - 1].index + 1} and ${ordered[i].index + 1} overlap`, ordered[i].index);
    }
  }

  let next = program;
  for (const match of [...ordered].reverse()) {
    next = next.slice(0, match.start) + match.replace + next.slice(match.end);
  }
  if (next === program) return fail('no_change', 'the edits leave the program unchanged', null);

  const spans = matches.map((match) => ({
    startLine: lineOf(program, match.start),
    endLine: lineOf(program, Math.max(match.start, match.end - 1)),
  }));
  return { ok: true, program: next, regionWarning: region.wholeFile, spans };
}

/** The editable region's text (for prompts), or the whole file with no markers. */
export function regionText(program: string): string {
  const located = findRegion(program);
  return located.ok ? program.slice(located.region.start, located.region.end) : program;
}
