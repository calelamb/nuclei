import { useRef } from 'react';
import { Upload } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { firstFile, loadCsvFile } from '../../services/qecCsvFile';
import { useCsvDrop } from './useCsvDrop';

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
        marginTop: 8, padding: '14px 18px', borderRadius: 8, maxWidth: 340,
        border: `1.5px dashed ${over ? colors.accent : colors.border}`,
        background: over ? `${colors.accent}14` : 'transparent',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        fontFamily: "'Geist Sans', sans-serif",
      }}
    >
      <Upload size={16} color={colors.textMuted} aria-hidden="true" />
      <div style={{ fontSize: 12, color: colors.text }}>Drop a sinter stats CSV to plot it</div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        style={{
          padding: '4px 10px', borderRadius: 5, border: `1px solid ${colors.border}`,
          background: 'transparent', color: colors.textMuted, fontSize: 11.5, cursor: 'pointer',
        }}
      >
        Choose file…
      </button>
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
      <div style={{ fontSize: 10.5, color: colors.textDim }}>Read in this app only — nothing is uploaded.</div>
    </div>
  );
}

/** Compact header button to open a CSV when results are already showing. */
export function QecCsvOpenButton() {
  const colors = useThemeStore((s) => s.colors);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, background: 'transparent',
          border: `1px solid ${colors.border}`, borderRadius: 5, color: colors.textMuted,
          cursor: 'pointer', fontSize: 12, padding: '5px 10px', fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        <Upload size={12} aria-hidden="true" /> Open CSV
      </button>
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
