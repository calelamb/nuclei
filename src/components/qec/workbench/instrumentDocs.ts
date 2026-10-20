import { DOCS_BASE, QEC_PLOT_CSV_DOCS } from '../../../config/docsLinks';
import type { QecWorkbenchPanelId } from '../../../layout/qecPanelRegistry';

const STUDIO_DOCS = `${DOCS_BASE}/research/qec-studio/`;
const WORKBENCH_DOCS = `${DOCS_BASE}/research/qec-workbench/`;

/** The docs page behind each instrument's help icon; every canvas card carries one. */
export function instrumentDocsHref(panelId: QecWorkbenchPanelId): string {
  switch (panelId) {
    case 'timeline':
    case 'lattice':
    case 'detector-graph': return STUDIO_DOCS;
    case 'campaign-center': return QEC_PLOT_CSV_DOCS;
    default: return WORKBENCH_DOCS;
  }
}
