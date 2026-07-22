import { Pin } from 'lucide-react';
import type { ReactElement } from 'react';

import type { QecWorkbenchPanelDef } from '../../../layout/qecPanelRegistry';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';

interface QecPanelPinButtonProps {
  panel: QecWorkbenchPanelDef;
}

export function QecPanelPinButton({ panel }: QecPanelPinButtonProps): ReactElement {
  const pinned = useQecWorkbenchStore((state) => state.pinnedPanelIds.includes(panel.id));
  const pinPanel = useQecWorkbenchStore((state) => state.pinPanel);
  const unpinPanel = useQecWorkbenchStore((state) => state.unpinPanel);
  const action = pinned ? 'Unpin' : 'Pin';
  return (
    <button
      type="button"
      className="qec-panel-pin"
      aria-label={`${action} ${panel.title}`}
      aria-pressed={pinned}
      title={`${action} ${panel.title} across workspace presets`}
      onClick={() => pinned ? unpinPanel(panel.id) : pinPanel(panel.id)}
    >
      <Pin aria-hidden="true" size={15} fill={pinned ? 'currentColor' : 'none'} />
    </button>
  );
}
