import { Check, Copy } from 'lucide-react';
import type { ReactElement } from 'react';

import { ICON_SIZE, ICON_STROKE } from '../../../styles/tokens';
import { IconButton } from '../../ui';
import { useCopied } from './useCopied';

/** Job ids are UUIDs; eight characters tell jobs apart and the full id stays in the tooltip and copy. */
export const SHORT_ID_LENGTH = 8;

/** The short job id with a copy button: the one way the wizard and the tray show an id. */
export function CopyJobId({ id }: { id: string }): ReactElement {
  const { copied, copy } = useCopied(id);
  const short = id.slice(0, SHORT_ID_LENGTH);
  const Icon = copied ? Check : Copy;
  return (
    <>
      <span className="qec-mono" title={id}>{short}</span>
      <IconButton size="sm" aria-label={`Copy job id ${short}`} tooltip={{ label: copied ? 'Copied' : 'Copy full job id' }} onClick={copy}>
        <Icon aria-hidden="true" size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />
      </IconButton>
    </>
  );
}
