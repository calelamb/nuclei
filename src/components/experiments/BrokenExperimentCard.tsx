import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Sparkles } from 'lucide-react';
import { usePlatform } from '../../platform/PlatformProvider';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { useProjectStore } from '../../stores/projectStore';
import { ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { Button } from '../ui';
import { explainValidationMessage, problemCountLabel } from './experimentValidationCopy';
import './experiments.css';

interface Props {
  readonly projectRoot: string;
  readonly fileName: string;
  readonly errors: readonly string[];
}

/**
 * A malformed experiment file, collapsed to "file · N problems" so one bad file
 * does not take a third of the rail. Expands to plain-language problems with a
 * way to open the file or hand it to Dirac.
 */
export function BrokenExperimentCard({ projectRoot, fileName, errors }: Props) {
  const [open, setOpen] = useState(false);
  const platform = usePlatform();
  const openTab = useProjectStore((s) => s.openTab);
  const ask = useDiracPanelStore((s) => s.ask);
  const path = `${projectRoot}/experiments/${fileName}`;
  const explained = errors.map(explainValidationMessage);

  const openFile = async () => {
    const content = await platform.readFile(path);
    if (content !== null) openTab({ path, content });
  };
  const askDirac = () => {
    ask(`${fileName} fails validation. Please fix it:\n${explained.map((e) => `- ${e}`).join('\n')}`);
  };
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div role="alert" className="nuclei-broken-experiment">
      <button
        type="button"
        className="nuclei-broken-experiment__head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Chevron size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
        <span className="nuclei-broken-experiment__file">{fileName}</span>
        <span className="nuclei-broken-experiment__count">{problemCountLabel(errors.length)}</span>
      </button>
      {open && (
        <div className="nuclei-broken-experiment__body">
          <ul>
            {explained.map((message) => <li key={message}>{message}</li>)}
          </ul>
          <div className="nuclei-broken-experiment__actions">
            <Button size="sm" icon={<FileText size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />} onClick={() => { void openFile(); }}>
              Open file
            </Button>
            <Button size="sm" icon={<Sparkles size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />} onClick={askDirac}>
              Ask Dirac to fix
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
