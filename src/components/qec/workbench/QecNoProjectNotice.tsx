import { FileSpreadsheet } from 'lucide-react';
import { usePlatform } from '../../../platform/PlatformProvider';
import { describeCounts } from '../../../lib/qecMappingSummary';
import { useQecCampaignStore } from '../../../stores/qecCampaignStore';
import { useThemeStore } from '../../../stores/themeStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { Button } from '../../ui';

import { ICON_SIZE, TYPOGRAPHY } from '../../../styles/tokens';
const FONT = TYPOGRAPHY.fontSans;

/** Sidebar content when no project folder is open (always the case in the web
 * build): says what still works here, and what the loaded CSV is. */
export function QecNoProjectNotice() {
  const colors = useThemeStore((s) => s.colors);
  const isWeb = usePlatform().getPlatform() === 'web';
  const csv = useQecCampaignStore((s) => s.csvImport);
  const preset = useQecWorkbenchStore((s) => s.preset);
  const setPreset = useQecWorkbenchStore((s) => s.setPreset);
  const points = useQecCampaignStore((s) => Object.keys(s.rowsByStrongId).length);
  const dim = { color: colors.textMuted, fontSize: 11, lineHeight: 1.5, margin: 0 } as const;
  return (
    <div style={{ display: 'grid', gap: 10, padding: 12, fontFamily: FONT }}>
      {csv ? (
        <section aria-label="Loaded CSV" style={{ display: 'grid', gap: 3 }}>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', color: colors.textMuted, fontSize: 11, fontWeight: 600 }}>
            <FileSpreadsheet size={ICON_SIZE.xs} />LOADED CSV
          </div>
          <div style={{ color: colors.text, fontSize: 12, fontWeight: 600, wordBreak: 'break-all' }}>{csv.sourceName}</div>
          <div style={dim}>{describeCounts({ totalDataRows: csv.totalDataRows, tasks: csv.rows.length, points, mergeKeys: csv.mapping.mergeKeys ?? [] })}</div>
        </section>
      ) : (
        <div style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
          <p style={dim}>Plot a sinter stats CSV in the Analyze view. It is read locally; nothing is uploaded.</p>
          {preset !== 'analyze' && <Button size="sm" onClick={() => setPreset('analyze')}>Open Analyze</Button>}
        </div>
      )}
      <p style={dim}>{isWeb
        ? 'Studies need a project folder, which is available in the desktop app.'
        : 'Open a project folder to create Studies.'}</p>
    </div>
  );
}
