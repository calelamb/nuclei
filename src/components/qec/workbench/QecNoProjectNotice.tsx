import { usePlatform } from '../../../platform/PlatformProvider';
import { useQecCampaignStore } from '../../../stores/qecCampaignStore';
import { useThemeStore } from '../../../stores/themeStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import { Button } from '../../ui';

import { TYPOGRAPHY } from '../../../styles/tokens';
const FONT = TYPOGRAPHY.fontSans;

/**
 * Sidebar content when no project folder is open (always the case in the web
 * build): says what still works here and where. A loaded CSV is named,
 * counted and mapped by the summary bar above the plot, so it is not repeated.
 */
export function QecNoProjectNotice() {
  const colors = useThemeStore((s) => s.colors);
  const isWeb = usePlatform().getPlatform() === 'web';
  const csvName = useQecCampaignStore((s) => s.csvImport?.sourceName ?? null);
  const preset = useQecWorkbenchStore((s) => s.preset);
  const setPreset = useQecWorkbenchStore((s) => s.setPreset);
  const dim = { color: colors.textMuted, fontSize: 12, lineHeight: 1.5, margin: 0 } as const;
  // The web build has no presets: its main panel is the analysis view, so the CSV drop zone is always in front of the person.
  const analyzeHere = isWeb || preset === 'analyze';
  const showHint = csvName === null || !analyzeHere;
  const hint = csvName !== null
    ? `${csvName} is loaded. Open Analyze to see it.`
    : analyzeHere
      ? 'Drop a sinter stats CSV in the main panel to plot it. It is read locally; nothing is uploaded.'
      : 'Plot a sinter stats CSV in the Analyze view. It is read locally; nothing is uploaded.';
  return (
    <div style={{ display: 'grid', gap: 10, padding: 12, fontFamily: FONT }}>
      {showHint && (
        <div style={{ display: 'grid', gap: 6, justifyItems: 'start' }}>
          <p style={dim}>{hint}</p>
          {!analyzeHere && <Button size="sm" onClick={() => setPreset('analyze')}>Open Analyze</Button>}
        </div>
      )}
      <p style={dim}>{isWeb
        ? 'Studies need a project folder, which is available in the desktop app.'
        : 'Open a project folder to create Studies.'}</p>
    </div>
  );
}
