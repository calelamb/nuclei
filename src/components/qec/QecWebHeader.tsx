import { Atom } from 'lucide-react';
import { ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { QecCampaignActions } from './QecCampaignActions';

/**
 * The web QEC Workbench has no sidebar to name it, so the page carries its own titled pane header
 * (same bar as the Transpiler Explorer): icon, h1, the loaded file, and the campaign actions on the right.
 */
export function QecWebHeader({ fileName }: { fileName: string | null }) {
  return (
    <div className="nuclei-pane-header">
      <h1 className="qec-web-header__title">
        <Atom size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> QEC Workbench
      </h1>
      {fileName && <span className="qec-web-header__name" title={fileName}>{fileName}</span>}
      <div style={{ flex: 1 }} />
      <QecCampaignActions />
    </div>
  );
}
