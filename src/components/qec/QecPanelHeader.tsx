import type { ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { IconButton } from '../ui';

interface QecPanelHeaderProps {
  /** Rendered as a real <h2> so the page outline reads QEC Workbench > panel. */
  title: string;
  /** Right-aligned controls (tabs, units, exports). */
  actions?: ReactNode;
  /** Deep link to the relevant docs page; renders the Help button. */
  helpHref?: string;
}

/**
 * The QEC analysis panels' header: same bar as the shared PanelHeader, but the
 * title is a heading element rather than a span.
 */
export function QecPanelHeader({ title, actions, helpHref }: QecPanelHeaderProps) {
  return (
    <div className="qec-panel-header">
      <h2 className="qec-panel-header__title">{title}</h2>
      <div className="qec-panel-header__spacer" />
      {actions}
      {helpHref && (
        <IconButton
          size="sm"
          aria-label="Help"
          tooltip={{ placement: 'below' }}
          onClick={() => window.open(helpHref, '_blank', 'noopener,noreferrer')}
        >
          <HelpCircle size={ICON_SIZE.md} strokeWidth={ICON_STROKE} />
        </IconButton>
      )}
    </div>
  );
}
