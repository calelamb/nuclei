import { useRef } from 'react';
import { Upload } from 'lucide-react';
import { useThemeStore } from '../../stores/themeStore';
import { firstFile, loadCsvFile } from '../../services/qecCsvFile';
import { useCsvDrop } from './useCsvDrop';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { QecCsvError } from './QecCsvError';
import { isWebBuild } from '../../platform/buildTarget';

export const CSV_ERROR_ID = 'qec-csv-error';

import { ICON_SIZE, ICON_STROKE, TYPOGRAPHY } from '../../styles/tokens';
import { Button } from '../ui';
/** Marks the header button that survives the empty state's unmount (focus handoff target). */
export const OPEN_CSV_ATTR = 'data-qec-open-csv';

/**
 * Picking a file from the empty state unmounts the drop zone and the focused
 * "Choose file…" button with it. Once the new view has rendered, hand focus to
 * the header's "Open CSV" button so keyboard users are not dropped on <body>.
 * Never steals focus that is already somewhere real.
 */
function restoreFocusAfterLoad(): void {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document.querySelector<HTMLElement>(`[${OPEN_CSV_ATTR}]`)?.focus();
  });
}

/** Drop target + file picker for a sinter stats CSV. Parsing happens locally;
 * nothing is uploaded. A rejected file is explained inside this card. */
export function QecCsvDropZone() {
  const colors = useThemeStore((s) => s.colors);
  const inputRef = useRef<HTMLInputElement>(null);
  const { over, handlers } = useCsvDrop();
  const csvError = useQecCampaignStore((s) => s.csvError);
  // With results on screen, QecAnalysisView's compact line owns the message instead.
  const hasData = useQecCampaignStore((s) => Object.keys(s.rowsByStrongId).length > 0);
  const showError = csvError !== null && !hasData;
  return (
    <div
      data-testid="csv-drop-zone"
      {...handlers}
      style={{
        marginTop: 8, padding: '14px 18px', borderRadius: 'var(--radius-round)', maxWidth: 360,
        border: `1.5px dashed ${over ? colors.accent : colors.border}`,
        background: over ? `${colors.accent}14` : 'transparent',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        fontFamily: TYPOGRAPHY.fontSans,
      }}
    >
      <Upload size={16} color={colors.textMuted} aria-hidden="true" />
      <div style={{ fontSize: 12, color: colors.text }}>Drop a sinter stats CSV to plot it</div>
      {showError && <QecCsvError id={CSV_ERROR_ID} message={csvError} />}
      <Button size="sm" aria-describedby={showError ? CSV_ERROR_ID : undefined} onClick={() => inputRef.current?.click()}>Choose file…</Button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.txt,text/csv,text/plain"
        aria-label="Choose sinter stats CSV"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = firstFile(e.target.files);
          if (file) void loadCsvFile(file).then(restoreFocusAfterLoad);
          e.target.value = ''; // allow re-picking the same file
        }}
      />
      <div style={{ fontSize: 11, color: colors.textDim, textAlign: 'center' }}>
        Read in this app only — nothing is uploaded.
        {/* The web build has no QEC sidebar, so the one thing it said lives here. */}
        {isWebBuild() && <><br />Studies need a project folder, which the desktop app provides.</>}
      </div>
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
        {...{ [OPEN_CSV_ATTR]: '' }}
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
