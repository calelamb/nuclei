import { Download } from 'lucide-react';
import type { ReactNode } from 'react';
import { DESKTOP_DOWNLOAD_URL } from '../../config/docsLinks';
import { openExternal } from '../../lib/openExternal';
import { ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { Button, EmptyState } from '../ui';

interface DesktopOnlyStateProps {
  /** What needs the desktop app, as a short sentence ("Hardware runs need the desktop app"). */
  title: string;
  /** Why, in one or two short sentences. */
  children: ReactNode;
  /** An optional secondary action for what does work in the browser. */
  alternative?: ReactNode;
}

/**
 * The one "this needs the desktop app" state for the web build: the same
 * centred icon, title, reason and a single Download action wherever a rail
 * view or the main area cannot work without the local kernel.
 */
export function DesktopOnlyState({ title, children, alternative }: DesktopOnlyStateProps) {
  return (
    <EmptyState
      icon={<Download size={ICON_SIZE.lg} strokeWidth={ICON_STROKE} />}
      title={title}
      action={(
        <div className="nuclei-desktop-only__actions">
          <Button size="sm" variant="primary" onClick={() => { void openExternal(DESKTOP_DOWNLOAD_URL); }}>
            Download Nuclei
          </Button>
          {alternative}
        </div>
      )}
    >
      {children}
    </EmptyState>
  );
}
