import { useRef } from 'react';
import { Upload } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { firstFile, loadCsvFile } from '../../services/qecCsvFile';
import { useCsvDrop } from './useCsvDrop';

import { ICON_SIZE, ICON_STROKE, TYPOGRAPHY } from '../../styles/tokens';
import { Button } from '../ui';
/** Drop target + file picker for a sinter stats CSV. Parsing happens locally;
 * nothing is uploaded. Load errors are shown by QecAnalysisView's banner. */
export function QecCsvDropZone() {
  const colors = useThemeStore((s) => s.colors);
  const inputRef = useRef<HTMLInputElement>(null);
  const { over, handlers } = useCsvDrop();
  return (
    <div
      data-testid="csv-drop-zone"
      {...handlers}
      style={{
        marginTop: 8, padding: '14px 18px', borderRadius: 'var(--radius-round)', maxWidth: 340,
        border: `1.5px dashed ${over ? colors.accent : colors.border}`,
        background: over ? `${colors.accent}14` : 'transparent',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        fontFamily: TYPOGRAPHY.fontSans,
      }}
    >
      <Upload size={16} color={colors.textMuted} aria-hidden="true" />
      <div style={{ fontSize: 12, color: colors.text }}>Drop a sinter stats CSV to plot it</div>
      <Button size="sm" onClick={() => inputRef.current?.click()}>Choose file…</Button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        aria-label="Choose sinter stats CSV"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = firstFile(e.target.files);
          if (file) void loadCsvFile(file);
          e.target.value = ''; // allow re-picking the same file
        }}
      />
      <div style={{ fontSize: 11, color: colors.textDim }}>Read in this app only — nothing is uploaded.</div>
    </div>
  );
}

/** Compact header button to open a CSV when results are already showing. */
export function QecCsvOpenButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        size="sm"
        onClick={() => inputRef.current?.click()}
        icon={<Upload size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />}
      >
        Open CSV
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        aria-label="Open sinter stats CSV"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = firstFile(e.target.files);
          if (file) void loadCsvFile(file);
          e.target.value = '';
        }}
      />
    </>
  );
}
