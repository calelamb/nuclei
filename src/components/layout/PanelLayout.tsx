import { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react';
import { usePlatform } from '../../platform/PlatformProvider';
import { ErrorBoundary } from '../ErrorBoundary';
import { QuantumEditor } from '../editor/QuantumEditor';
import { EditorTabs } from '../editor/EditorTabs';
import { Breadcrumbs, ExperimentBreadcrumbs } from '../editor/Breadcrumbs';
import { ProbabilityHistogram } from '../histogram/ProbabilityHistogram';
import { BlochPanel } from '../bloch/BlochPanel';
import { DiracSidePanel } from '../dirac/DiracSidePanel';
import { ActivityBar } from './ActivityBar';
import type { ActivityView } from './ActivityBar';
import { Sidebar } from './Sidebar';
import { PanelReveal } from './PanelReveal';
import { HistogramChip } from '../histogram/HistogramChip';
import { LaunchStrip } from '../hardware/LaunchStrip';
import { useHardwareStore } from '../../stores/hardwareStore';
import { useLayoutStore, type LayoutPreset } from '../../stores/layoutStore';
import { resolveVisiblePanels } from '../../layout/panelRegistry';
import { StatusBar } from './StatusBar';
import { ModeSwitchDialog } from './ModeSwitchDialog';
import { ResearchTour } from './ResearchTour';
import { useModeSwitchStore } from '../../stores/modeSwitchStore';
import { useResearchTourStore } from '../../stores/researchTourStore';
import { useDiracStore } from '../../stores/diracStore';
import { DEFAULT_EDITOR_PANE_WIDTH, computeEditorPaneWidth } from './layoutMath';
import { useEditorStore } from '../../stores/editorStore';
import { useCircuitStore } from '../../stores/circuitStore';
import { useSimulationStore } from '../../stores/simulationStore';
import { useThemeStore } from '../../stores/themeStore';
import { useUIModeStore } from '../../stores/uiModeStore';
import { useLearnStore } from '../../stores/learnStore';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { activityViewsForMode } from './panelRegistry';
import { ChevronDown, ChevronUp, Trash2, Copy, Clock } from 'lucide-react';
import { useBottomPanelStore } from '../../stores/bottomPanelStore';
import type { TerminalLine } from '../../stores/simulationStore';

const LearnModeView = lazy(async () => ({
  default: (await import('../learning/LearnModeView')).LearnModeView,
}));
const ChallengeModeView = lazy(async () => ({
  default: (await import('../challenges/ChallengeModeView')).ChallengeModeView,
}));
const RunsTable = lazy(async () => ({
  default: (await import('../experiments/RunsTable')).RunsTable,
}));
const RunDetail = lazy(async () => ({
  default: (await import('../experiments/RunDetail')).RunDetail,
}));
const CompareView = lazy(async () => ({
  default: (await import('../experiments/CompareView')).CompareView,
}));

const DEFAULT_BOTTOM_HEIGHT = 200;
const DEFAULT_SIDEBAR_WIDTH = 240;

/* ── Hardware-aware histogram chip ──
 * Wraps HistogramChip to pipe in the most recent completed hardware-job
 * probabilities alongside the classical-simulator run. When a hardware job
 * has completed, the chip shows dual bars per outcome (sim vs hw).
 */
function HardwareAwareHistogramChip({
  simProbabilities,
  onDismiss,
}: {
  simProbabilities: Record<string, number> | null;
  onDismiss: () => void;
}) {
  const jobs = useHardwareStore((s) => s.jobs);
  const results = useHardwareStore((s) => s.results);
  const completed = jobs.find((j) => j.status === 'complete');
  const hwProbabilities = completed ? results[completed.id]?.probabilities ?? null : null;
  const hwLabel = completed ? `${completed.backend} (${completed.shots} shots)` : undefined;
  return (
    <HistogramChip
      probabilities={simProbabilities}
      hwProbabilities={hwProbabilities}
      hwLabel={hwLabel}
      onDismiss={onDismiss}
    />
  );
}

/* ── Terminal Panel ── */

const ERROR_PATTERN = /\b(error|traceback|exception)\b/i;
const WARNING_PATTERN = /\bwarning\b/i;

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  const ss = d.getSeconds().toString().padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function lineColor(
  line: TerminalLine,
  colors: ReturnType<typeof useThemeStore.getState>['colors'],
): string {
  if (line.type === 'separator') return colors.textDim;
  if (line.type === 'stderr') return colors.error;
  if (line.type === 'info') return colors.textMuted;
  // stdout — but still flag tracebacks/warnings that bubbled through the
  // stdout channel (some libs print errors to stdout instead of stderr).
  if (ERROR_PATTERN.test(line.text)) return colors.error;
  if (WARNING_PATTERN.test(line.text)) return colors.warning;
  return colors.text;
}

function ToolbarButton({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        height: 18,
        padding: '0 6px',
        background: active ? `${colors.accent}20` : 'transparent',
        border: 'none',
        borderRadius: 3,
        color: active ? colors.accent : colors.textDim,
        cursor: 'pointer',
        fontSize: 10,
        fontFamily: "'Geist Sans', sans-serif",
        fontWeight: 500,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.color = colors.text;
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.color = colors.textDim;
      }}
    >
      {children}
    </button>
  );
}

function TerminalToolbar({
  lineCount,
  onClear,
  onCopy,
  copied,
}: {
  lineCount: number;
  onClear: () => void;
  onCopy: () => void;
  copied: boolean;
}) {
  const colors = useThemeStore((s) => s.colors);
  const autoScroll = useBottomPanelStore((s) => s.autoScroll);
  const showTimestamps = useBottomPanelStore((s) => s.showTimestamps);
  const filter = useBottomPanelStore((s) => s.filter);
  const toggleAutoScroll = useBottomPanelStore((s) => s.toggleAutoScroll);
  const toggleShowTimestamps = useBottomPanelStore((s) => s.toggleShowTimestamps);
  const setFilter = useBottomPanelStore((s) => s.setFilter);

  return (
    <div
      style={{
        height: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 8px',
        borderBottom: `1px solid ${colors.border}`,
        background: colors.bg,
        flexShrink: 0,
      }}
      role="toolbar"
      aria-label="Terminal toolbar"
    >
      <ToolbarButton onClick={onClear} title="Clear terminal">
        <Trash2 size={11} />
      </ToolbarButton>
      <ToolbarButton onClick={onCopy} title={copied ? 'Copied!' : 'Copy all output'}>
        <Copy size={11} />
        {copied && <span style={{ fontSize: 9 }}>copied</span>}
      </ToolbarButton>
      <ToolbarButton
        onClick={toggleShowTimestamps}
        title="Toggle timestamps"
        active={showTimestamps}
      >
        <Clock size={11} />
      </ToolbarButton>
      <ToolbarButton
        onClick={toggleAutoScroll}
        title="Auto-scroll to bottom"
        active={autoScroll}
      >
        Auto-scroll
      </ToolbarButton>

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter"
        aria-label="Filter terminal lines"
        style={{
          marginLeft: 4,
          width: 120,
          height: 18,
          padding: '0 6px',
          background: colors.bgElevated,
          border: `1px solid ${colors.border}`,
          borderRadius: 3,
          color: colors.text,
          fontSize: 10,
          fontFamily: "'Geist Sans', sans-serif",
          outline: 'none',
        }}
      />

      <div style={{ flex: 1 }} />

      <span
        style={{
          color: colors.textDim,
          fontSize: 10,
          fontFamily: "'Geist Mono', monospace",
        }}
      >
        {lineCount} {lineCount === 1 ? 'line' : 'lines'}
      </span>
    </div>
  );
}

function TerminalPanel() {
  const terminalOutput = useSimulationStore((s) => s.terminalOutput);
  const clearOutput = useSimulationStore((s) => s.clearOutput);
  const colors = useThemeStore((s) => s.colors);
  const rewritten = useDiracStore((s) => s.rewrittenError);
  const clearRewrittenError = useDiracStore((s) => s.clearRewrittenError);
  const setCode = useEditorStore((s) => s.setCode);
  const autoScroll = useBottomPanelStore((s) => s.autoScroll);
  const showTimestamps = useBottomPanelStore((s) => s.showTimestamps);
  const filter = useBottomPanelStore((s) => s.filter);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  const filterLower = filter.trim().toLowerCase();
  const visibleLines = filterLower
    ? terminalOutput.filter(
        (l) => l.type === 'separator' || l.text.toLowerCase().includes(filterLower),
      )
    : terminalOutput;

  useEffect(() => {
    if (!autoScroll) return;
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visibleLines, rewritten, autoScroll]);

  const handleCopy = useCallback(async () => {
    const text = terminalOutput
      .filter((l) => l.type !== 'separator')
      .map((l) => l.text)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Non-critical — clipboard may be unavailable in the web build or
      // restricted iframes. Silently fail.
    }
  }, [terminalOutput]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: colors.bg }}>
      <TerminalToolbar
        lineCount={terminalOutput.length}
        onClear={clearOutput}
        onCopy={handleCopy}
        copied={copied}
      />
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
          fontSize: 12,
          color: colors.text,
          padding: '8px 12px',
          userSelect: 'text',
        }}
      >
        {rewritten && (
          <div
            role="alert"
            style={{
              marginBottom: 10,
              padding: '10px 12px',
              border: `1px solid ${colors.dirac}40`,
              borderRadius: 10,
              background: `${colors.dirac}12`,
              fontFamily: "'Geist Sans', sans-serif",
              fontSize: 12,
              lineHeight: 1.5,
              color: colors.text,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: colors.dirac, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 10 }}>
              Dirac
            </div>
            <div style={{ marginBottom: rewritten.fix ? 10 : 0 }}>{rewritten.explanation}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {rewritten.fix && (
                <button
                  onClick={() => { setCode(rewritten.fix!); clearRewrittenError(); }}
                  style={{
                    background: colors.dirac, color: '#fff', border: 'none',
                    borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', fontFamily: "'Geist Sans', sans-serif",
                  }}
                >Apply fix</button>
              )}
              <button
                onClick={clearRewrittenError}
                style={{
                  background: 'transparent', color: colors.textDim,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6, padding: '4px 10px', fontSize: 11,
                  cursor: 'pointer', fontFamily: "'Geist Sans', sans-serif",
                }}
              >Dismiss</button>
            </div>
          </div>
        )}
        {visibleLines.length === 0 && !rewritten ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.textDim }}>
            <span style={{ color: colors.accent, opacity: 0.3, fontFamily: "'Geist Mono', monospace" }}>{'>'}_</span>
            <span style={{ fontSize: 11 }}>
              {filterLower ? 'No lines match the filter.' : 'Terminal output will appear here'}
            </span>
          </div>
        ) : visibleLines.map((line, i) => {
          const isStderr = line.type === 'stderr';
          const isSeparator = line.type === 'separator';
          const fontStyle = isStderr ? 'italic' : 'normal';
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 8,
                color: lineColor(line, colors),
                fontStyle,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {showTimestamps && !isSeparator && (
                <span
                  style={{
                    color: colors.textDim,
                    opacity: 0.7,
                    flexShrink: 0,
                    userSelect: 'none',
                  }}
                >
                  [{formatTimestamp(line.timestamp)}]
                </span>
              )}
              <span style={{ flex: 1 }}>{line.text || '\u00a0'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Bottom Panel ──
 * In the new progressive-reveal layout the histogram no longer lives here;
 * it's rendered as a compact chip beneath the Bloch sphere. The bottom
 * panel shows Terminal by default, and the full histogram only when the
 * user has opted into the `full` layout preset.
 */
function BottomPanel({
  showFullHistogram,
}: {
  showFullHistogram: boolean;
}) {
  const collapsed = useBottomPanelStore((s) => s.collapsed);
  const activeTab = useBottomPanelStore((s) => s.activeTab);
  const toggleCollapsed = useBottomPanelStore((s) => s.toggleCollapsed);
  const setCollapsed = useBottomPanelStore((s) => s.setCollapsed);
  const setActiveTab = useBottomPanelStore((s) => s.setActiveTab);
  const result = useSimulationStore((s) => s.result);
  const colors = useThemeStore((s) => s.colors);

  // Auto-focus histogram tab on a new result, but only if the full histogram
  // is actually available (otherwise the tab would be a dead link). Lives
  // here rather than in the store so we can condition on showFullHistogram,
  // which is a layout-preset-derived prop owned by the parent.
  useEffect(() => {
    if (result && showFullHistogram) queueMicrotask(() => setActiveTab('histogram'));
  }, [result, showFullHistogram, setActiveTab]);

  // When the full histogram tab disappears (layout preset changed), snap
  // back to terminal so we never render an invisible tab.
  useEffect(() => {
    if (!showFullHistogram && activeTab === 'histogram') {
      queueMicrotask(() => setActiveTab('terminal'));
    }
  }, [showFullHistogram, activeTab, setActiveTab]);

  const tabs: Array<'terminal' | 'histogram'> = showFullHistogram
    ? ['terminal', 'histogram']
    : ['terminal'];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Panel header */}
      <div style={{ height: 28, display: 'flex', alignItems: 'center', borderBottom: collapsed ? 'none' : `1px solid ${colors.border}`, backgroundColor: colors.bg, flexShrink: 0 }}>
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => { if (collapsed) setCollapsed(false); setActiveTab(tab); }}
            style={{
              padding: '0 14px', height: '100%',
              background: 'transparent',
              color: !collapsed && activeTab === tab ? colors.text : colors.textDim,
              border: 'none',
              borderBottom: !collapsed && activeTab === tab ? `1px solid ${colors.accent}` : '1px solid transparent',
              cursor: 'pointer', fontSize: 10, fontWeight: 500,
              fontFamily: "'Geist Sans', sans-serif", textTransform: 'uppercase', letterSpacing: 0.5,
            }}
            role="tab"
            aria-selected={!collapsed && activeTab === tab}
          >
            {tab}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={toggleCollapsed} style={{ background: 'transparent', border: 'none', color: colors.textDim, cursor: 'pointer', padding: '0 10px', display: 'flex', alignItems: 'center' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.text; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}
          aria-label={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>
      {!collapsed && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {activeTab === 'terminal' || !showFullHistogram
            ? <TerminalPanel />
            : <ProbabilityHistogram />}
        </div>
      )}
    </div>
  );
}

/* ── Resize Handle ── */
function ResizeHandle({ direction, isDragging, onMouseDown, onDoubleClick }: {
  direction: 'horizontal' | 'vertical'; isDragging: boolean; onMouseDown: () => void; onDoubleClick: () => void;
}) {
  const colors = useThemeStore((s) => s.colors);
  const isH = direction === 'horizontal';
  return (
    <div style={{ [isH ? 'width' : 'height']: isDragging ? 2 : 1, cursor: isH ? 'col-resize' : 'row-resize',
      backgroundColor: isDragging ? colors.accent : colors.border, flexShrink: 0, position: 'relative',
      transition: isDragging ? 'none' : 'all 150ms ease' }}
      onMouseDown={onMouseDown} onDoubleClick={onDoubleClick} role="separator">
      <div style={{ position: 'absolute', [isH ? 'left' : 'top']: -3, [isH ? 'right' : 'bottom']: -3,
        [isH ? 'width' : 'height']: 8, [isH ? 'top' : 'left']: 0, [isH ? 'bottom' : 'right']: 0, zIndex: 2 }}
        onMouseEnter={(e) => { const p = e.currentTarget.parentElement; if (p && !isDragging) { p.style.backgroundColor = colors.accent; p.style[isH ? 'width' : 'height'] = '2px'; } }}
        onMouseLeave={(e) => { const p = e.currentTarget.parentElement; if (p && !isDragging) { p.style.backgroundColor = colors.border; p.style[isH ? 'width' : 'height'] = '1px'; } }}
      />
    </div>
  );
}

/* ── Main Layout ── */
export function PanelLayout() {
  const [activeView, setActiveView] = useState<ActivityView | null>('files');
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [bottomHeight, setBottomHeight] = useState(DEFAULT_BOTTOM_HEIGHT);
  const [editorPaneWidth, setEditorPaneWidth] = useState(DEFAULT_EDITOR_PANE_WIDTH);
  const bottomCollapsed = useBottomPanelStore((s) => s.collapsed);
  const setBottomCollapsed = useBottomPanelStore((s) => s.setCollapsed);
  const [isDraggingH, setIsDraggingH] = useState(false);
  const [isDraggingV, setIsDraggingV] = useState(false);

  const colors = useThemeStore((s) => s.colors);
  const uiMode = useUIModeStore((s) => s.mode);
  const experimentalFeatures = useSettingsStore((s) => s.general.experimentalFeatures);
  const workspaceMode = useWorkspaceStore((s) => s.mode);
  const result = useSimulationStore((s) => s.result);
  const terminalOutput = useSimulationStore((s) => s.terminalOutput);
  const snapshot = useCircuitStore((s) => s.snapshot);
  const platform = usePlatform();
  const isLearnMode = useLearnStore((s) => s.isLearnMode);
  const enterLearnMode = useLearnStore((s) => s.enterLearnMode);
  const exitLearnMode = useLearnStore((s) => s.exitLearnMode);
  const isChallengeMode = useChallengeModeStore((s) => s.isChallengeMode);
  const enterChallengeMode = useChallengeModeStore((s) => s.enterChallengeMode);
  const exitChallengeMode = useChallengeModeStore((s) => s.exitChallengeMode);
  const selectedExperimentFileName = useExperimentUiStore((s) => s.selectedExperimentFileName);
  const selectedRunDir = useExperimentUiStore((s) => s.selectedRunDir);
  const compareOpen = useExperimentUiStore((s) => s.compareOpen);

  const preset = useLayoutStore((s) => s.preset);
  const setPreset = useLayoutStore((s) => s.setPreset);
  const chipDismissed = useLayoutStore((s) => s.histogramChipDismissed);
  const dismissChip = useLayoutStore((s) => s.dismissHistogramChip);
  const resetRunArtifacts = useLayoutStore((s) => s.resetRunArtifacts);
  const panelOverrides = useLayoutStore((s) => s.overrides);
  const hydrateOverrides = useLayoutStore((s) => s.hydrateOverrides);
  const projectRoot = useProjectStore((s) => s.projectRoot);

  // Registry-driven visibility (PRD 11 Phase A). With no user overrides —
  // the default — this returns exactly what computeVisiblePanels returned;
  // the parity is locked by src/layout/panelRegistry.test.ts.
  const visible = resolveVisiblePanels(
    {
      preset,
      snapshot,
      result,
      hasTerminalOutput: terminalOutput.length > 0,
      errorActive: false,
      mode: workspaceMode,
      framework: snapshot?.framework ?? null,
    },
    panelOverrides,
  );

  const showBottomPanel = visible.terminal || visible.histogramFull;
  const showSidebar = !isLearnMode && !isChallengeMode && activeView !== null;
  const topSplitRef = useRef<HTMLDivElement>(null);

  // PRD 09 Phase D — Research mode swaps the main content area for the
  // runs table (or run detail, once a row is picked) whenever the
  // Experiments rail item is active AND an experiment is selected. With no
  // selection yet, Research mode still shows the ordinary editor+viz area
  // (Explorer/editor stay available — Experiments isn't the only thing you
  // can do in Research mode).
  const showExperimentsMain =
    workspaceMode === 'research' && activeView === 'experiments' && selectedExperimentFileName !== null;

  // Single source of truth for which activity-bar views exist right now —
  // see panelRegistry.ts. Learn mode reproduces today's exact set; Research
  // mode hides learning/challenges/community and adds the Experiments
  // placeholder.
  const visibleActivityViews = activityViewsForMode(workspaceMode, { experimentalFeatures });

  useEffect(() => {
    // Fresh run should re-show a previously-dismissed histogram chip.
    if (result) resetRunArtifacts();
  }, [result, resetRunArtifacts]);

  useEffect(() => {
    if (uiMode === 'beginner' && result) setBottomCollapsed(false);
  }, [result, uiMode, setBottomCollapsed]);

  useEffect(() => {
    if (activeView && !visibleActivityViews.includes(activeView)) {
      setActiveView('files');
    }
    // visibleActivityViews is recomputed every render (new array identity);
    // depend on its inputs instead so this doesn't refire spuriously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, experimentalFeatures, workspaceMode]);

  // Workspace mode switch (PRD 09 A3): Learn-only full-view surfaces
  // (Learn Mode, Challenge Mode) are unreachable in Research, so exiting
  // them here is what actually enforces the gate — the activity-bar item
  // being hidden only stops new entry. A ref guards this so it only fires
  // on an actual mode transition, never on ordinary in-mode navigation
  // (e.g. toggling Learn Mode off leaves activeView untouched today, and
  // must keep doing so for byte-compatibility).
  const prevWorkspaceModeRef = useRef(workspaceMode);
  const maybeAutoStartTour = useResearchTourStore((s) => s.maybeAutoStart);
  useEffect(() => {
    if (prevWorkspaceModeRef.current === workspaceMode) return;
    prevWorkspaceModeRef.current = workspaceMode;
    if (isLearnMode) exitLearnMode();
    if (isChallengeMode) exitChallengeMode();
    setActiveView((prev) => (prev && visibleActivityViews.includes(prev) ? prev : 'files'));
    // First entry into Research shows the orientation tour once (PRD 11 B).
    if (workspaceMode === 'research') maybeAutoStartTour();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceMode, isLearnMode, isChallengeMode, exitLearnMode, exitChallengeMode]);

  // Load persisted layout
  useEffect(() => {
    (async () => {
      try {
        const bh = await platform.getStoredValue<number>('layout_bottomHeight');
        const sw = await platform.getStoredValue<number>('layout_sidebarWidth');
        const epw = await platform.getStoredValue<number>('layout_editorPaneWidth');
        const lp = await platform.getStoredValue<LayoutPreset>('layout_preset');
        if (bh) setBottomHeight(bh);
        if (sw) setSidebarWidth(sw);
        if (epw) setEditorPaneWidth(epw);
        if (lp === 'clean' || lp === 'balanced' || lp === 'full') setPreset(lp);
      } catch { /* non-critical layout persistence */ }
    })();
  }, [platform, setPreset]);

  // Per-project panel visibility overrides (PRD 11 Phase A). Loaded when the
  // open project changes; persisted (debounced) when the user toggles a panel
  // via the PanelHeader (arriving in Phase C). Keyed by project root so each
  // project keeps its own arrangement; a null root (no project open) uses a
  // shared bucket. No override exists by default, so this is inert until a
  // toggle UI ships — the resolved panel set stays identical to v0.6.x.
  const overridesKey = `layout_panelOverrides:${projectRoot ?? '__global__'}`;
  const loadedOverridesForRef = useRef<string | null>(null);
  useEffect(() => {
    if (loadedOverridesForRef.current === overridesKey) return;
    loadedOverridesForRef.current = overridesKey;
    (async () => {
      try {
        const stored = await platform.getStoredValue<Record<string, boolean>>(overridesKey);
        hydrateOverrides(stored && typeof stored === 'object' ? stored : {});
      } catch {
        hydrateOverrides({});
      }
    })();
  }, [overridesKey, platform, hydrateOverrides]);

  const overridesPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Skip the persist that would immediately follow a project-load hydrate.
    if (loadedOverridesForRef.current !== overridesKey) return;
    if (overridesPersistTimerRef.current) clearTimeout(overridesPersistTimerRef.current);
    overridesPersistTimerRef.current = setTimeout(async () => {
      try {
        await platform.setStoredValue(overridesKey, panelOverrides);
      } catch { /* non-critical layout persistence */ }
    }, 500);
  }, [panelOverrides, overridesKey, platform]);

  // Listen for cross-component navigation to Settings
  const settingsSignal = useNavigationStore((s) => s.settingsSignal);
  useEffect(() => {
    if (settingsSignal > 0) {
      if (isLearnMode) exitLearnMode();
      if (isChallengeMode) exitChallengeMode();
      setActiveView('settings');
    }
  }, [settingsSignal, isLearnMode, isChallengeMode, exitLearnMode, exitChallengeMode]);

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(async () => {
      try {
        await platform.setStoredValue('layout_bottomHeight', bottomHeight);
        await platform.setStoredValue('layout_sidebarWidth', sidebarWidth);
        await platform.setStoredValue('layout_editorPaneWidth', editorPaneWidth);
      } catch { /* non-critical layout persistence */ }
    }, 500);
  }, [bottomHeight, editorPaneWidth, sidebarWidth, platform]);

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDraggingH) {
      const rect = topSplitRef.current?.getBoundingClientRect();
      if (rect) {
        setEditorPaneWidth(computeEditorPaneWidth(e.clientX, rect));
      }
    }
    if (isDraggingV) {
      const fromBottom = window.innerHeight - e.clientY - 22; // account for status bar
      setBottomHeight(Math.max(80, Math.min(500, fromBottom)));
    }
  };

  const handleMouseUp = () => { setIsDraggingH(false); setIsDraggingV(false); };

  const handleActivitySelect = (view: ActivityView) => {
    if (view === 'learning') {
      if (isLearnMode) {
        exitLearnMode();
      } else {
        enterLearnMode();
        if (isChallengeMode) exitChallengeMode();
        setActiveView(null);
      }
      return;
    }
    if (view === 'challenges') {
      if (isChallengeMode) {
        exitChallengeMode();
      } else {
        enterChallengeMode();
        if (isLearnMode) exitLearnMode();
        setActiveView(null);
      }
      return;
    }
    // If in learn mode or challenge mode and clicking another view, exit first
    if (isLearnMode) exitLearnMode();
    if (isChallengeMode) exitChallengeMode();
    setActiveView((prev) => prev === view ? null : view);
  };

  const effectiveBottomHeight = bottomCollapsed ? 28 : bottomHeight;

  return (
    <div
      style={{
        width: '100vw', height: '100vh',
        display: 'flex', flexDirection: 'column',
        backgroundColor: colors.bg,
        overflow: 'hidden',
        userSelect: isDraggingH || isDraggingV ? 'none' : 'auto',
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Main area (everything except status bar) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Activity Bar */}
        <ActivityBar
          active={isChallengeMode ? 'challenges' : isLearnMode ? 'learning' : activeView}
          onSelect={handleActivitySelect}
          visibleViews={visibleActivityViews}
          workspaceMode={workspaceMode}
        />

        {/* Sidebar (hidden in Learn Mode) */}
        {showSidebar && activeView && (
          <Sidebar view={activeView} width={sidebarWidth} onWidthChange={setSidebarWidth} />
        )}

        {isChallengeMode ? (
          /* Challenge Mode — full content area */
          <div style={{
            flex: 1, minWidth: 0, overflow: 'hidden',
            animation: 'nuclei-fade-in 200ms ease',
          }}>
            <Suspense fallback={null}>
              <ChallengeModeView />
            </Suspense>
          </div>
        ) : isLearnMode ? (
          /* Learn Mode — full content area + Dirac */
          <div style={{
            flex: 1, minWidth: 0, overflow: 'hidden',
            animation: 'nuclei-fade-in 200ms ease',
          }}>
            <Suspense fallback={null}>
              <LearnModeView />
            </Suspense>
          </div>
        ) : showExperimentsMain ? (
          /* PRD 09 Phase D — Research mode's runs table / run detail,
             swapped in for the ordinary editor+viz area while an experiment
             is selected in the Experiments rail. PRD 11 Phase C adds the
             experiment→run breadcrumb trail at the top. */
          <div style={{
            flex: 1, minWidth: 0, overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            animation: 'nuclei-fade-in 200ms ease',
          }}>
            <ExperimentBreadcrumbs />
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <Suspense fallback={null}>
                {compareOpen ? <CompareView /> : selectedRunDir ? <RunDetail /> : <RunsTable />}
              </Suspense>
            </div>
          </div>
        ) : (
          <>
            {/* Editor + Viz area */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {/* Top: editor area + visualization */}
              <div ref={topSplitRef} style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Left: Editor with tabs + breadcrumbs + launch strip */}
                <div style={{ width: `${editorPaneWidth}%`, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <EditorTabs />
                  <Breadcrumbs />
                  <ErrorBoundary label="Launch Strip">
                    <LaunchStrip />
                  </ErrorBoundary>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <ErrorBoundary label="Code Editor">
                      <QuantumEditor />
                    </ErrorBoundary>
                  </div>
                </div>

                {/* Resize handle between editor and viz */}
                <ResizeHandle
                  direction="horizontal"
                  isDragging={isDraggingH}
                  onMouseDown={() => setIsDraggingH(true)}
                  onDoubleClick={() => setEditorPaneWidth(DEFAULT_EDITOR_PANE_WIDTH)}
                />

                {/* Right rail: interactive Bloch sphere (full height) +
                    histogram chip. The gate-circuit diagram previously
                    shared this rail but was clipping against the top of
                    the panel and competing for vertical space with the
                    Bloch viz — removed so the sphere gets the full rail
                    and the rail stays uncluttered. */}
                <div style={{ width: `${100 - editorPaneWidth}%`, minWidth: 200, display: 'flex', flexDirection: 'column' }}>
                  <PanelReveal when={visible.bloch} from="right">
                    <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 240 }}>
                      <BlochPanel />
                    </div>
                  </PanelReveal>
                  <PanelReveal when={visible.histogramChip && !chipDismissed} from="bottom">
                    <div style={{ padding: '6px 10px 10px', flexShrink: 0 }}>
                      <HardwareAwareHistogramChip
                        simProbabilities={result?.probabilities ?? null}
                        onDismiss={dismissChip}
                      />
                    </div>
                  </PanelReveal>
                </div>
              </div>

              {/* Bottom panel */}
              {(showBottomPanel || result) && (
                <>
                  {!bottomCollapsed && (
                    <ResizeHandle
                      direction="vertical"
                      isDragging={isDraggingV}
                      onMouseDown={() => setIsDraggingV(true)}
                      onDoubleClick={() => setBottomHeight(DEFAULT_BOTTOM_HEIGHT)}
                    />
                  )}
                  <div style={{ height: effectiveBottomHeight, overflow: 'hidden', flexShrink: 0 }}>
                    <BottomPanel
                      showFullHistogram={visible.histogramFull}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Dirac side panel (Code Mode only — Learn Mode has its own) */}
            <DiracSidePanel />
          </>
        )}
      </div>

      {/* Status bar — full width at bottom */}
      <StatusBar />

      {/* Mode identity chrome (PRD 11 Phase B) — dialog + tour portal to
          document.body; the announcer is a visually-hidden polite live
          region that reads out mode changes for screen readers. */}
      <ModeSwitchDialog />
      <ResearchTour />
      <ModeAnnouncer />
    </div>
  );
}

/** Visually-hidden aria-live region announcing workspace-mode changes. */
function ModeAnnouncer() {
  const announcement = useModeSwitchStore((s) => s.announcement);
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        padding: 0,
        margin: -1,
        overflow: 'hidden',
        clip: 'rect(0 0 0 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {announcement}
    </div>
  );
}
