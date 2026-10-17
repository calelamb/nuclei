import { FileSpreadsheet } from 'lucide-react';
import { usePlatform } from '../../../platform/PlatformProvider';
import { describeMapping } from '../../../lib/qecMappingSummary';
import { useQecCampaignStore } from '../../../stores/qecCampaignStore';
import { useThemeStore } from '../../../stores/themeStore';

const FONT = "'Geist Sans', sans-serif";

/** Sidebar content when no project folder is open (always the case in the web
 * build): says what still works here, and what the loaded CSV is. */
export function QecNoProjectNotice() {
  const colors = useThemeStore((s) => s.colors);
  const isWeb = usePlatform().getPlatform() === 'web';
  const csv = useQecCampaignStore((s) => s.csvImport);
  const dim = { color: colors.textDim, fontSize: 11, lineHeight: 1.5, margin: 0 } as const;
  return (
    <div style={{ display: 'grid', gap: 10, padding: 12, fontFamily: FONT }}>
      {csv ? (
        <section aria-label="Loaded CSV" style={{ display: 'grid', gap: 3 }}>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', color: colors.textMuted, fontSize: 10, fontWeight: 600 }}>
            <FileSpreadsheet size={12} />LOADED CSV
          </div>
          <div style={{ color: colors.text, fontSize: 12, fontWeight: 600, wordBreak: 'break-all' }}>{csv.sourceName}</div>
          <div style={dim}>{csv.totalDataRows.toLocaleString()} rows · {csv.rows.length.toLocaleString()} tasks</div>
          <div style={dim}>{describeMapping(csv.mapping)}</div>
        </section>
      ) : (
        <p style={dim}>Drop a sinter stats CSV in the main panel to plot it. It is read locally; nothing is uploaded.</p>
      )}
      <p style={dim}>{isWeb
        ? 'QEC Studies need a project folder, which is available in the desktop app.'
        : 'QEC Studies need a project folder. Open one to create Studies.'}</p>
    </div>
  );
}
