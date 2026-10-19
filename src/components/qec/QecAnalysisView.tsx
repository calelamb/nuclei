import { useRef, useState } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useQecCampaignStore } from '../../stores/qecCampaignStore';
import { useExperimentStore } from '../../services/experimentStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { QecCampaignActions } from './QecCampaignActions';
import { Tabs } from '../ui';
import { useElementSize } from '../../hooks/useElementSize';
import { canStackLambda, isShortAnalysis } from '../../lib/qecAnalysisLayout';
import { ThresholdPanel } from './ThresholdPanel';
import { DecoderWorkbench } from './DecoderWorkbench';
import { isWebBuild } from '../../platform/buildTarget';
import { CsvMappingPreview } from './CsvMappingPreview';
import { QecCsvDropZone, CSV_ERROR_ID } from './QecCsvDropZone';
import { QecCsvError } from './QecCsvError';
import { QecEmptyState } from './QecEmptyState';
import { QEC_PLOT_CSV_DOCS } from '../../config/docsLinks';
import { useCsvDrop } from './useCsvDrop';
import { QecWebHeader } from './QecWebHeader';

import { TYPOGRAPHY } from '../../styles/tokens';
/** Opening the mapping editor must never squeeze the figure below this; the column scrolls instead. */
const PLOT_MIN_HEIGHT = 320;
/** Stacked with the table the section also holds the title bar, controls, legend and footnote: ~240px of drawing area needs this much. */
const PLOT_SECTION_MIN_HEIGHT = 440;
/** About eight decoder rows plus the sticky header: below this the column scrolls instead of crushing the table. */
const TABLE_MIN_HEIGHT = 390;
type AnalysisTab = 'plot' | 'lambda' | 'decoders';
const ANALYSIS_TABS = [
  { value: 'plot', label: 'Plot' },
  { value: 'lambda', label: 'Λ fit' },
  { value: 'decoders', label: 'Decoders' },
] as const;
/** When Λ sits under the plot there is no separate Λ section. */
const STACKED_TABS = ANALYSIS_TABS.filter((t) => t.value !== 'lambda');


/**
 * PRD 10 Phase E — the campaign analysis surface, shown in the experiments
 * main area when a QEC campaign experiment is selected. Stacks the threshold/Λ
 * plot over the decoder workbench; a slim progress strip on top reflects the
 * live campaign (or a resumable prior run).
 */
export function QecAnalysisView({ embedded = false, actionsInHeader = false }: { embedded?: boolean; actionsInHeader?: boolean } = {}) {
  const colors = useThemeStore((s) => s.colors);
  const running = useQecCampaignStore((s) => s.running);
  const progress = useQecCampaignStore((s) => s.progress);
  const resumable = useQecCampaignStore((s) => s.resumable);
  const selectedFileName = useExperimentUiStore((s) => s.selectedExperimentFileName);
  const experiment = useExperimentStore((s) =>
    s.experiments.find((e) => e.fileName === selectedFileName),
  );
  const csvSource = useQecCampaignStore((s) => s.csvImport?.sourceName ?? null);
  const csvError = useQecCampaignStore((s) => s.csvError);
  const csvLoading = useQecCampaignStore((s) => s.csvLoading);
  const { over, handlers } = useCsvDrop();
  const hasData = useQecCampaignStore((s) => Object.keys(s.rowsByStrongId).length > 0);

  const [scrollRef, scrollSize] = useElementSize<HTMLDivElement>();
  const rootRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<AnalysisTab>('plot');
  const tabbed = isShortAnalysis(scrollSize.height, scrollSize.width);
  const lambdaBelow = tabbed && canStackLambda(scrollSize.height, scrollSize.width);
  // Λ lives under the plot when there is room; its tab would be a dead end then.
  const activeTab: AnalysisTab = lambdaBelow && tab === 'lambda' ? 'plot' : tab;

  // Sections are real tabs (underline, one row of their own); the units control keeps the segmented style so the two never look alike.
  const tabSwitch = (
    <Tabs aria-label="Analysis section" value={activeTab} options={lambdaBelow ? STACKED_TABS : ANALYSIS_TABS} onChange={setTab} />
  );

  const webOnly = isWebBuild(); // no kernel to run campaigns in the browser
  // Before any data there is one way in: the empty state's drop zone. A header Open CSV and a plot title bar would be two more.
  const awaitingData = !hasData && !csvSource && !running && !resumable;
  // The web build is a page of its own (no sidebar to name it), so it always carries the titled pane header.
  const webPage = webOnly && !embedded;
  const showHeader = !webPage && !actionsInHeader && !(awaitingData && webOnly);
  // A loaded file is named by the mapping summary below; inside the workbench the card heading already says
  // "Campaign Center", so a generic fallback would repeat it.
  const title = csvSource ? null : experiment?.spec.name ?? (embedded ? null : 'Campaign');

  return (
    <div
      {...handlers}
      ref={rootRef}
      tabIndex={-1}
      style={{
        outlineStyle: over ? 'dashed' : 'none',
        height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg,
        outlineWidth: 2, outlineColor: colors.accent, outlineOffset: -2,
      }}
    >
      {webPage && <QecWebHeader fileName={csvSource} />}
      {showHeader && (
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
          borderBottom: `1px solid ${colors.border}`, fontFamily: TYPOGRAPHY.fontSans,
        }}
      >
        {title && (
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <QecCampaignActions embedded={embedded} />
      </div>
      )}
      {csvLoading && (
        <div role="status" aria-live="polite" style={{ padding: '6px 12px', fontSize: 12, color: colors.textMuted, borderBottom: `1px solid ${colors.border}`, fontFamily: TYPOGRAPHY.fontSans }}>
          {`Reading ${csvLoading}…`}
        </div>
      )}
      {/* With no data the drop-zone card explains a rejected file where the person acted; otherwise a compact line does. */}
      {csvError && (hasData || csvSource) && <QecCsvError compact id={CSV_ERROR_ID} message={csvError} stillShowing={csvSource} onDismissed={() => rootRef.current?.focus()} />}
      {(running || resumable) && (
        <div
          aria-live="polite"
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
            borderBottom: `1px solid ${colors.border}`, fontSize: 11,
            color: running ? colors.accentText : colors.warning, fontFamily: TYPOGRAPHY.fontSans,
          }}
        >
          {running && progress ? (
            <>
              <span
                style={{
                  width: 6, height: 6, borderRadius: 3, background: colors.accent,
                  animation: 'nuclei-heartbeat 1.5s ease infinite',
                }}
              />
              Running · {progress.tasksComplete}/{progress.tasksTotal} tasks ·{' '}
              {progress.sampledShots.toLocaleString()} shots
              {progress.statusMessage ? ` · ${progress.statusMessage}` : ''}
            </>
          ) : resumable ? (
            <>Campaign “{resumable.name}” was interrupted — its results are resumable.</>
          ) : null}
        </div>
      )}
      {embedded && !hasData ? (
        <>
          <CsvMappingPreview />
          <QecEmptyState
            title="No campaign results yet"
            body={webOnly
              ? 'See logical error rate vs physical error and compare decoders.'
              : 'Run a QEC campaign from Experiments, or load existing results, to see logical error rate vs physical error and compare decoders.'}
            docsHref={QEC_PLOT_CSV_DOCS}
            align={embedded ? 'top' : 'center'}
          >
            {!csvSource && <QecCsvDropZone />}
          </QecEmptyState>
        </>
      ) : (
        /* The plot keeps a usable height; on short windows the page scrolls
           instead of squeezing the plot and the decoder table to slivers. */
        <div ref={scrollRef} data-testid="qec-analysis-scroll" className={webPage ? 'qec-web-body' : undefined} style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {/* The mapping summary and its editor scroll with the figure: opening the editor must not take height from the plot. */}
          <CsvMappingPreview />
          {tabbed ? (
            <>
              {/* flex: none: a tall table must not squeeze the tab strip down to its border. */}
              {hasData && <div style={{ flex: 'none', padding: '0 12px' }}>{tabSwitch}</div>}
              <div style={{ flex: '1 0 auto', minHeight: PLOT_MIN_HEIGHT }}>
                {activeTab === 'decoders' && hasData
                  ? <DecoderWorkbench />
                  : <ThresholdPanel part={hasData ? (lambdaBelow ? 'all' : activeTab === 'decoders' ? 'plot' : activeTab) : 'all'} />}
              </div>
            </>
          ) : (
            <>
              <div style={{ flex: hasData ? '2 1 0' : '1 1 0', minHeight: hasData ? PLOT_SECTION_MIN_HEIGHT : PLOT_MIN_HEIGHT, borderBottom: hasData ? `1px solid ${colors.border}` : undefined }}>
                <ThresholdPanel bare={awaitingData} />
              </div>
              {/* Until data loads there is nothing to compare: one empty state, not one per panel. */}
              {hasData && (
                <div style={{ flex: '1 1 0', minHeight: TABLE_MIN_HEIGHT }}>
                  {/* The plot header above already carries the units control; a second one would be a duplicate. */}
                  <DecoderWorkbench showUnits={false} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
