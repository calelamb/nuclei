import { useState } from 'react';
import { FileText, Cpu } from 'lucide-react';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { Button, TextArea, TextInput } from '../ui';
import '../dirac/dirac.css';
import './lessonBlocks.css';

export function ResearchPaperReader() {
  const ask = useDiracPanelStore((s) => s.ask);
  const [arxivUrl, setArxivUrl] = useState('');
  const [abstractText, setAbstractText] = useState('');

  const content = abstractText.trim() || arxivUrl.trim();
  const hasContent = content.length > 0;

  const sendToDirac = (prefix: string) => {
    if (!hasContent) return;
    ask(`${prefix}\n${content}`);
  };

  return (
    <div className="paper">
      <div className="paper__title">Research Paper Reader</div>
      <div className="paper__lede">Paste an arXiv link or abstract and let Dirac explain it or generate a circuit from it.</div>

      <TextInput placeholder="Paste arXiv URL..." aria-label="arXiv URL" value={arxivUrl} onChange={(e) => setArxivUrl(e.target.value)} />

      <div className="paper__or" aria-hidden="true"><span>OR</span></div>

      <TextArea
        placeholder="Paste abstract or paper excerpt here..."
        aria-label="Abstract or excerpt"
        rows={6}
        value={abstractText}
        onChange={(e) => setAbstractText(e.target.value)}
      />

      <div className="paper__actions">
        <Button className="dirac-btn-dirac" disabled={!hasContent} icon={<FileText size={12} aria-hidden="true" />} onClick={() => sendToDirac('[Research Paper]')}>
          Explain with Dirac
        </Button>
        <Button variant="primary" disabled={!hasContent} icon={<Cpu size={12} aria-hidden="true" />} onClick={() => sendToDirac('[Generate circuit from paper]')}>
          Generate Circuit
        </Button>
      </div>
    </div>
  );
}
