import { useState } from 'react';
import { FileText, Cpu } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { useDiracPanelStore } from '../../stores/diracPanelStore';

import { TYPOGRAPHY } from '../../styles/tokens';
export function ResearchPaperReader() {
  const colors = useThemeStore((s) => s.colors);
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
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ color: colors.text, fontSize: 13, fontWeight: 600, fontFamily: TYPOGRAPHY.fontSans }}>
        Research Paper Reader
      </div>
      <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, lineHeight: 1.4 }}>
        Paste an arXiv link or abstract and let Dirac explain it or generate a circuit from it.
      </div>

      {/* URL input */}
      <input
        type="text"
        placeholder="Paste arXiv URL..."
        value={arxivUrl}
        onChange={(e) => setArxivUrl(e.target.value)}
        style={{
          width: '100%',
          padding: '6px 8px',
          background: colors.bgPanel,
          border: `1px solid ${colors.border}`,
          borderRadius: 4,
          color: colors.text,
          fontSize: 12,
          fontFamily: TYPOGRAPHY.fontSans,
          boxSizing: 'border-box',
        }}
      />

      {/* OR divider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 1, background: colors.border }} />
        <span style={{ color: colors.textDim, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans }}>OR</span>
        <div style={{ flex: 1, height: 1, background: colors.border }} />
      </div>

      {/* Abstract textarea */}
      <textarea
        placeholder="Paste abstract or paper excerpt here..."
        value={abstractText}
        onChange={(e) => setAbstractText(e.target.value)}
        rows={6}
        style={{
          width: '100%',
          padding: '6px 8px',
          background: colors.bgPanel,
          border: `1px solid ${colors.border}`,
          borderRadius: 4,
          color: colors.text,
          fontSize: 12,
          fontFamily: TYPOGRAPHY.fontSans,
          resize: 'vertical',
          lineHeight: 1.5,
          boxSizing: 'border-box',
        }}
      />

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => sendToDirac('[Research Paper]')}
          disabled={!hasContent}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            padding: '6px 12px',
            background: hasContent ? colors.dirac : colors.bgPanel,
            color: hasContent ? '#fff' : colors.textDim,
            border: 'none',
            borderRadius: 4,
            cursor: hasContent ? 'pointer' : 'default',
            fontSize: 11,
            fontWeight: 600,
            fontFamily: TYPOGRAPHY.fontSans,
            opacity: hasContent ? 1 : 0.5,
          }}
        >
          <FileText size={12} />
          Explain with Dirac
        </button>
        <button
          onClick={() => sendToDirac('[Generate circuit from paper]')}
          disabled={!hasContent}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
            padding: '6px 12px',
            background: hasContent ? colors.accent : colors.bgPanel,
            color: hasContent ? '#fff' : colors.textDim,
            border: 'none',
            borderRadius: 4,
            cursor: hasContent ? 'pointer' : 'default',
            fontSize: 11,
            fontWeight: 600,
            fontFamily: TYPOGRAPHY.fontSans,
            opacity: hasContent ? 1 : 0.5,
          }}
        >
          <Cpu size={12} />
          Generate Circuit
        </button>
      </div>
    </div>
  );
}
