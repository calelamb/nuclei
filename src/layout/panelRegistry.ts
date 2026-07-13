import type { LucideIcon } from 'lucide-react';
import type { CircuitSnapshot, Framework, SimulationResult } from '../types/quantum';
import type { WorkspaceMode } from '../stores/workspaceStore';
import type { LayoutPreset } from '../stores/layoutStore';

/**
 * PRD 11 Phase A — the panel registry.
 *
 * Single declarative source of truth for the workspace's visualization and
 * bottom panels: each panel declares its zone, the modes that offer it, its
 * framework affinity, and the reveal rule that decides default visibility.
 * `resolveVisiblePanels` computes the visible set from registry + context +
 * per-project user overrides.
 *
 * WHY THIS EXISTS: `layoutStore.computeVisiblePanels` returned a hardcoded
 * `{circuit, bloch, histogramChip, histogramFull, terminal}` struct, which
 * could not express PRD 10's need to swap Bloch → lattice/detector-graph by
 * framework without widening the struct every time. The registry computes;
 * components stop asking.
 *
 * MIGRATION DISCIPLINE (PRD 11 Risk 1): the `defaultVisible` functions below
 * are a VERBATIM relocation of the old `computeVisiblePanels` logic — the
 * reveal behavior is load-bearing pedagogy for Learn mode. The relocated
 * unit tests plus the resolved-Learn-output snapshot in
 * `panelRegistry.test.ts` prove parity with v0.6.x under identical inputs.
 *
 * The left-rail (activity-bar) panels still live in
 * `src/components/layout/panelRegistry.ts` (`activityViewsForMode`); PRD 11
 * Phase C folds them into this registry when it rewires the ActivityBar.
 */

export type PanelZone = 'left' | 'viz' | 'bottom';

/** Visualization + bottom panels whose visibility the reveal rules govern.
 * Extended by PRD 10 Phase D (lattice, detector-graph, …) and PRD 11 Phase C
 * (left-rail views). */
export type PanelId =
  | 'circuit'
  | 'bloch'
  | 'histogramChip'
  | 'histogramFull'
  | 'terminal';

/** Everything a reveal rule may read. `framework` and `mode` are new inputs
 * the registry threads through for affinity; the four preset/evidence inputs
 * are exactly what `computeVisiblePanels` consumed. */
export interface VisibilityCtx {
  preset: LayoutPreset;
  snapshot: CircuitSnapshot | null;
  result: SimulationResult | null;
  hasTerminalOutput: boolean;
  errorActive: boolean;
  mode: WorkspaceMode;
  /** Active framework (from the snapshot), used for viz-zone affinity.
   * `null` when no circuit has been parsed — affinity treats null as
   * "don't hide", preserving pre-registry behavior. */
  framework: Framework | null;
}

export interface PanelDef {
  id: PanelId;
  title: string;
  icon?: LucideIcon;
  zone: PanelZone;
  /** Modes that offer this panel at all. */
  modes: WorkspaceMode[];
  /** Viz-zone framework affinity. `'any'` = every framework. A concrete
   * list hides the panel for frameworks not in it (e.g. PRD 10 Phase D sets
   * `bloch` to the non-stim frameworks and gives lattice/detector-graph
   * `['stim']`). In Phase A every panel is `'any'` — the mechanism ships and
   * is tested, but nothing changes what renders today. */
  frameworks: Framework[] | 'any';
  /** Reveal rule — VERBATIM from the old computeVisiblePanels. Pure. */
  defaultVisible: (ctx: VisibilityCtx) => boolean;
  order: number;
}

/** The resolved visibility map — same shape the old `VisiblePanels` had, so
 * `PanelLayout` and its consumers are untouched by the migration. */
export type VisiblePanels = Record<PanelId, boolean>;

// ── Reveal rules, relocated verbatim from layoutStore.computeVisiblePanels ──
//
// The original computed all five panels together inside one function with a
// per-preset branch. Split per panel here so each can be tested and swapped
// independently, but the logic is byte-for-byte equivalent — see the
// resolved-output snapshot test.

function hasGates(snapshot: CircuitSnapshot | null): boolean {
  return Boolean(snapshot && snapshot.gates.length > 0);
}

export const PANEL_REGISTRY: readonly PanelDef[] = [
  {
    id: 'circuit',
    title: 'Circuit',
    zone: 'viz',
    modes: ['learn', 'research'],
    frameworks: 'any',
    order: 0,
    defaultVisible: ({ preset, snapshot }) => {
      if (preset === 'full') return true;
      if (preset === 'balanced') return true;
      return hasGates(snapshot); // clean
    },
  },
  {
    id: 'bloch',
    title: 'Bloch Sphere',
    zone: 'viz',
    modes: ['learn', 'research'],
    // Stays 'any' in Phase A (zero behavior change). PRD 10 Phase D narrows
    // this to the non-stim frameworks and registers lattice/detector-graph
    // with `['stim']` to complete the swap.
    frameworks: 'any',
    order: 1,
    defaultVisible: ({ preset, result }) => {
      if (preset === 'full') return true;
      if (preset === 'balanced') return true;
      return Boolean(result); // clean
    },
  },
  {
    id: 'histogramChip',
    title: 'Histogram',
    zone: 'viz',
    modes: ['learn', 'research'],
    frameworks: 'any',
    order: 2,
    defaultVisible: ({ preset, result }) => {
      if (preset === 'full') return false;
      if (preset === 'balanced') return Boolean(result);
      return Boolean(result); // clean
    },
  },
  {
    id: 'histogramFull',
    title: 'Histogram',
    zone: 'bottom',
    modes: ['learn', 'research'],
    frameworks: 'any',
    order: 3,
    defaultVisible: ({ preset }) => {
      if (preset === 'full') return true;
      if (preset === 'balanced') return false;
      return false; // clean
    },
  },
  {
    id: 'terminal',
    title: 'Terminal',
    zone: 'bottom',
    modes: ['learn', 'research'],
    frameworks: 'any',
    order: 4,
    defaultVisible: ({ preset, hasTerminalOutput, errorActive }) => {
      if (preset === 'full') return true;
      // balanced + clean share the same terminal rule.
      return hasTerminalOutput || errorActive;
    },
  },
];

/** True when the panel's framework affinity admits the active framework.
 * `'any'` always admits; a `null` framework (no circuit yet) always admits
 * so the pre-registry "show regardless of framework" behavior is preserved. */
export function panelPassesFramework(
  panel: Pick<PanelDef, 'frameworks'>,
  framework: Framework | null,
): boolean {
  if (panel.frameworks === 'any') return true;
  if (framework === null) return true;
  return panel.frameworks.includes(framework);
}

/**
 * Resolve which viz/bottom panels are visible.
 *
 * Precedence: an explicit per-project user override wins over the reveal
 * rule, but framework affinity is a hard capability gate on top (a user
 * cannot force-show a panel that is meaningless for the active framework).
 * With no overrides set — the Phase A default — this returns exactly what
 * `computeVisiblePanels` returned.
 */
export function resolveVisiblePanels(
  ctx: VisibilityCtx,
  overrides: Partial<Record<PanelId, boolean>> = {},
): VisiblePanels {
  const out = {} as VisiblePanels;
  for (const panel of PANEL_REGISTRY) {
    const base = overrides[panel.id] ?? panel.defaultVisible(ctx);
    out[panel.id] = base && panelPassesFramework(panel, ctx.framework);
  }
  return out;
}

/** Panels in a zone, in declared order — for zone-based rendering/tabbing. */
export function panelsInZone(zone: PanelZone): PanelDef[] {
  return PANEL_REGISTRY.filter((p) => p.zone === zone).sort((a, b) => a.order - b.order);
}
