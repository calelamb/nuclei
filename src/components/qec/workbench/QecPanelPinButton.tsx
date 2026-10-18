import { Pin } from 'lucide-react';
import type { ReactElement } from 'react';

import type { QecWorkbenchPanelDef } from '../../../layout/qecPanelRegistry';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { ICON_SIZE, ICON_STROKE } from '../../../styles/tokens';
import { IconButton } from '../../ui';

interface QecPanelPinButtonProps {
  panel: QecWorkbenchPanelDef;
}

/** Pin an instrument across workspace presets: a 28px icon button with the shared tooltip (its tap target stays 44px via CSS). */
export function QecPanelPinButton({ panel }: QecPanelPinButtonProps): ReactElement {
  const pinned = useQecWorkbenchStore((state) => state.pinnedPanelIds.includes(panel.id));
  const pinPanel = useQecWorkbenchStore((state) => state.pinPanel);
  const unpinPanel = useQecWorkbenchStore((state) => state.unpinPanel);
  const action = pinned ? 'Unpin' : 'Pin';
  return (
    <IconButton
      className="qec-panel-pin"
      aria-label={`${action} ${panel.title}`}
      aria-pressed={pinned}
      tooltip={{ label: `${action} across workspace presets`, placement: 'below' }}
      onClick={() => pinned ? unpinPanel(panel.id) : pinPanel(panel.id)}
    >
      <Pin aria-hidden="true" size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} fill={pinned ? 'currentColor' : 'none'} />
    </IconButton>
  );
}
