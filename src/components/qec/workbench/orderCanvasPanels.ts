import type { QecWorkbenchPanelDef, QecWorkbenchPanelId } from '../../../layout/qecPanelRegistry';
import type { QecWorkspacePreset } from '../../../types/qecStudy';

/** The preset's defining instrument leads, so it is never below the fold. */
const LEADING_INSTRUMENT: Partial<Readonly<Record<QecWorkspacePreset, QecWorkbenchPanelId>>> = {
  analyze: 'campaign-center',
};

export function orderCanvasPanels(
  preset: QecWorkspacePreset, panels: readonly QecWorkbenchPanelDef[],
): readonly QecWorkbenchPanelDef[] {
  const lead = LEADING_INSTRUMENT[preset];
  return lead ? [...panels].sort((a, b) => Number(b.id === lead) - Number(a.id === lead)) : panels;
}
