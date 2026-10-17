import { Monitor } from 'lucide-react';
import { Button } from '../ui';
import { openExternal } from '../../lib/openExternal';
import { DESKTOP_DOWNLOAD_URL, DESKTOP_VS_WEB_DOCS } from '../../config/docsLinks';
import './lessonBlocks.css';

interface UnsupportedNoticeProps {
  /** The runtime's own explanation of what is outside the browser subset. */
  message: string;
}

/**
 * Calm, non-error state for code the browser build can't run (it ships a
 * Qiskit subset, not full Qiskit). Not red: the student did nothing wrong.
 */
export function UnsupportedNotice({ message }: UnsupportedNoticeProps) {
  return (
    <div role="status" className="notice">
      <Monitor className="notice__icon" size={14} aria-hidden="true" />
      <div className="notice__body">
        <div className="notice__title">Runs in the desktop app</div>
        <div className="notice__text">{message}</div>
        <div className="notice__actions">
          <Button size="sm" onClick={() => { void openExternal(DESKTOP_DOWNLOAD_URL); }}>Get the desktop app</Button>
          <Button size="sm" variant="ghost" onClick={() => { void openExternal(DESKTOP_VS_WEB_DOCS); }}>What runs in the browser</Button>
        </div>
      </div>
    </div>
  );
}
