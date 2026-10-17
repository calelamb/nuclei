import { useState } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import type { DiracErrorInfo } from '../../lib/diracErrors';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { Button } from '../ui';
import './dirac.css';

const COPIED_RESET_MS = 2000;

/** A failed Dirac turn: plain-language cause and next step, raw detail behind "Copy details". */
export function DiracErrorCard({ error }: { error: DiracErrorInfo }) {
  const [copied, setCopied] = useState(false);
  const requestKeyUpdate = useDiracPanelStore((s) => s.requestKeyUpdate);

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(error.details);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="dirac-error" role="alert">
      <p className="dirac-error__title">{error.title}</p>
      <p className="dirac-error__message">{error.message}</p>
      <div className="dirac-error__actions">
        {error.action === 'update-key' && (
          <Button size="sm" variant="primary" icon={<KeyRound size={14} />} onClick={requestKeyUpdate}>
            Update key
          </Button>
        )}
        {error.details && (
          <Button size="sm" variant="ghost" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copyDetails}>
            {copied ? 'Copied' : 'Copy details'}
          </Button>
        )}
      </div>
    </div>
  );
}
