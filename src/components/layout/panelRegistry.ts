import type { ActivityView } from './ActivityBar';
import type { WorkspaceMode } from '../../stores/workspaceStore';

export interface PanelRegistryOptions {
  experimentalFeatures: boolean;
}

// Learn mode — EXACTLY today's set, same order. Do not reorder or edit
// these two arrays without updating the ActivityBar snapshot test; that
// test is the byte-compatibility enforcement mechanism for PRD 09
// Constraint 1 (Learn mode byte-compatibility).
const LEARN_CORE: ActivityView[] = ['files', 'learning', 'challenges', 'launch'];
const LEARN_EXPERIMENTAL: ActivityView[] = ['search', 'circuit', 'plugins', 'hardware', 'community'];
const LEARN_BOTTOM: ActivityView[] = ['settings'];

// Research mode — hides learning/challenges/community (and onboarding/
// playground/educator surfaces, which aren't activity views at all).
// Shows Explorer (default active), the Experiments placeholder (Phase D
// fills it in), hardware, launch, settings. Unlike Learn, this set does
// not depend on `experimentalFeatures` — hardware/launch are core to the
// research workflow, not experimental extras gated behind a settings flag.
const RESEARCH_TOP: ActivityView[] = ['files', 'experiments', 'hardware', 'launch'];
const RESEARCH_BOTTOM: ActivityView[] = ['settings'];

/**
 * Single source of truth for which activity-bar views exist in a given
 * workspace mode. Pure function — no component may re-derive this list
 * with its own `if (mode === ...)` conditionals; compute it once here and
 * pass the result down.
 */
export function activityViewsForMode(
  mode: WorkspaceMode,
  { experimentalFeatures }: PanelRegistryOptions,
): ActivityView[] {
  if (mode === 'research') {
    return [...RESEARCH_TOP, ...RESEARCH_BOTTOM];
  }
  const top = experimentalFeatures ? [...LEARN_CORE, ...LEARN_EXPERIMENTAL] : [...LEARN_CORE];
  return [...top, ...LEARN_BOTTOM];
}

/** Views rendered pinned to the bottom of the rail, regardless of mode. */
export function bottomViewsForMode(mode: WorkspaceMode): ActivityView[] {
  return mode === 'research' ? RESEARCH_BOTTOM : LEARN_BOTTOM;
}
