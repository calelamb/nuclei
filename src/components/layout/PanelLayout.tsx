import { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react';
import { usePlatform } from '../../platform/PlatformProvider';
import { ErrorBoundary } from '../ErrorBoundary';
import { QuantumEditor } from '../editor/QuantumEditor';
import { EditorTabs } from '../editor/EditorTabs';
import { KernelBanner } from '../editor/KernelBanner';
import { Breadcrumbs, ExperimentBreadcrumbs } from '../editor/Breadcrumbs';
import { VizZone } from '../qec/VizZone';
import { useQecStore } from '../../stores/qecStore';
import './vizRail.css';
import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { useRoomRetreat } from '../../layout/useRoomRetreat';
import { useShellLayout } from '../../hooks/useShellLayout';
import { useUiFeatures } from '../../hooks/useUiFeatures';
import { useElementSize } from '../../hooks/useElementSize';
import { vizColumnHasContent, vizPlaceholder } from '../../layout/vizPanels';
import { EDITOR_MIN_WIDTH, VIZ_MIN_WIDTH, vizRailTab } from '../../layout/breakpoints';
import { DiracSidePanel } from '../dirac/DiracSidePanel';
import { ActivityBar } from './ActivityBar';
import type { ActivityView } from './ActivityBar';
import { Sidebar } from './Sidebar';
import { PanelReveal } from './PanelReveal';
import { LaunchStrip } from '../hardware/LaunchStrip';
import { useLayoutStore, type LayoutPreset } from '../../stores/layoutStore';
import { resolveVisiblePanels } from '../../layout/panelRegistry';
import { StatusBar } from './StatusBar';
import { BottomPanel } from './BottomPanel';
import { ResizeHandle } from './ResizeHandle';
import { HardwareAwareHistogramChip } from './HardwareAwareHistogramChip';
import { ModeSwitchDialog } from './ModeSwitchDialog';
import { ResearchTour } from './ResearchTour';
import { useModeSwitchStore } from '../../stores/modeSwitchStore';
import { useResearchTourStore } from '../../stores/researchTourStore';
import { DEFAULT_EDITOR_PANE_WIDTH, computeEditorPaneWidth } from './layoutMath';
import { useDisplaySnapshot } from '../../layout/useDisplaySnapshot';
import { useEditorStore } from '../../stores/editorStore';
import { hasMeaningfulOutput, useSimulationStore } from '../../stores/simulationStore';
import { sampledProbabilities } from '../histogram/histogramData';
import { shouldRenderBottomPanel } from '../../layout/bottomPanelPresence';
import { useThemeStore } from '../../stores/themeStore';
import { useUIModeStore } from '../../stores/uiModeStore';
import { useLearnStore } from '../../stores/learnStore';
import { useChallengeModeStore } from '../../stores/challengeModeStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useProjectStore } from '../../stores/projectStore';
import { useExperimentUiStore } from '../../stores/experimentUiStore';
import { useExperimentStore } from '../../services/experimentStore';
import { activityViewsForMode } from './panelRegistry';
import { isWebBuild } from '../../platform/buildTarget';
import { useBottomPanelStore } from '../../stores/bottomPanelStore';

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
const QecAnalysisView = lazy(async () => ({
  default: (await import('../qec/QecAnalysisView')).QecAnalysisView,
}));
const TranspilerExplorer = lazy(async () => ({
  default: (await import('../transpiler/TranspilerExplorer')).TranspilerExplorer,
}));
const QecWorkbench = lazy(async () => ({
  default: (await import('../qec/workbench/QecWorkbench')).QecWorkbench,
}));

const DEFAULT_BOTTOM_HEIGHT = 200;
/** The full histogram opened from the chip needs room for the plot, not a strip. */
const EXPANDED_HISTOGRAM_HEIGHT = 280;
const DEFAULT_SIDEBAR_WIDTH = 240;

/* ── Main Layout ── */
export function PanelLayout() {
  // Rail navigation now lives in the navigation store (PRD 11 Phase D) so the
  // palette, ⌘1..9 shortcuts, and the Dirac gear can drive it.
  const activeView = useNavigationStore((s) => s.activeView);
  const setActiveView = useNavigationStore((s) => s.setActiveView);
  const setViewKeepingViewport = useNavigationStore((s) => s.setViewKeepingViewport);
  const toggleView = useNavigationStore((s) => s.toggleView);
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
  const lastRunFailed = useSimulationStore((s) => s.lastRunFailed);
  const { snapshot } = useDisplaySnapshot();
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
  const histogramExpanded = useLayoutStore((s) => s.histogramExpanded);
  const setHistogramExpanded = useLayoutStore((s) => s.setHistogramExpanded);
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
      hasTerminalOutput: hasMeaningfulOutput(terminalOutput),
      errorActive: lastRunFailed,
      mode: workspaceMode,
      framework: snapshot?.framework ?? null,
      histogramExpanded,
    },
    panelOverrides,
  );

  const showBottomPanel = visible.terminal || visible.histogramFull;
  const features = useUiFeatures();
  // Beginner mode hides the Explorer; every other rail view still opens its sidebar.
  // Learn and Challenge own the whole area, except that Settings may open beside them.
  const fullViewOwnsArea = (isLearnMode || isChallengeMode) && activeView !== 'settings';
  const showSidebar = !fullViewOwnsArea && activeView !== null
    && (features.explorerSidebar || activeView !== 'files');
  const topSplitRef = useRef<HTMLDivElement | null>(null);
  const [measureTopSplit, topSplitSize] = useElementSize<HTMLDivElement>();
  const setTopSplitRef = useCallback((el: HTMLDivElement | null) => {
    topSplitRef.current = el;
    measureTopSplit(el);
  }, [measureTopSplit]);
  const qecSnapshot = useQecStore((s) => s.snapshot);

  // PRD 09 Phase D — Research mode swaps the main content area for the
  // runs table (or run detail, once a row is picked) whenever the
  // Experiments rail item is active AND an experiment is selected. With no
  // selection yet, Research mode still shows the ordinary editor+viz area
  // (Explorer/editor stay available — Experiments isn't the only thing you
  // can do in Research mode).
  const showExperimentsMain =
    workspaceMode === 'research' && activeView === 'experiments' && selectedExperimentFileName !== null;

  // Transpiler Explorer (dev tools Phase 1) — Research mode swaps the main
  // editor+viz area for the before/after transpile view whenever the
  // Transpiler rail item is active (controls sit in the sidebar).
  const showTranspilerMain = workspaceMode === 'research' && activeView === 'transpiler';
  const showQecWorkbench = workspaceMode === 'research' && activeView === 'qec';

  // dev tools Phase 4 / P4.1 — when a Research takeover (transpiler/experiments)
  // is active, the editor+viz area is HIDDEN, not unmounted, so Monaco keeps its
  // per-tab models, undo, cursor, and scroll across the switch.
  const editorHidden = showTranspilerMain || showExperimentsMain || showQecWorkbench;

  // A selected QEC campaign experiment shows the analysis surface (threshold +
  // decoder workbench, PRD 10 Phase E) instead of the sweep runs table.
  const selectedExperiment = useExperimentStore((s) =>
    s.experiments.find((e) => e.fileName === selectedExperimentFileName),
  );
  const selectedIsCampaign = selectedExperiment?.spec.type === 'qec_campaign';

  // Single source of truth for which activity-bar views exist right now —
  // see panelRegistry.ts. Learn mode reproduces today's exact set; Research
  // mode hides learning/challenges/community and adds the Experiments
  // placeholder.
  const visibleActivityViews = activityViewsForMode(workspaceMode, { experimentalFeatures })
    .filter((v) => features.explorerSidebar || v !== 'files');

  // The right rail only takes space when it has something to show AND the
  // editor can keep a usable width beside it. Otherwise the editor gets the
  // whole row (the rail is empty before the first parse in the Clean preset,
  // and a 200px empty column used to crush the editor at <= 1100px).
  // "+N more" on the chip opens the full histogram: the Full preset puts it in the bottom panel.
  const setBottomTab = useBottomPanelStore((s) => s.setActiveTab);
  const expandHistogram = useCallback(() => {
    setBottomCollapsed(false);
    setBottomTab('histogram');
    setBottomHeight((h) => Math.max(h, EXPANDED_HISTOGRAM_HEIGHT));
    setHistogramExpanded(true);
  }, [setBottomCollapsed, setBottomTab, setHistogramExpanded]);
  const bottomTab = useBottomPanelStore((s) => s.activeTab);
  // The expansion is temporary: collapsing the panel or leaving the Histogram tab hands the rail its chip back.
  useEffect(() => {
    if (histogramExpanded && (bottomCollapsed || bottomTab !== 'histogram')) setHistogramExpanded(false);
  }, [histogramExpanded, bottomCollapsed, bottomTab, setHistogramExpanded]);
  // The chip that had focus is gone: land on the Histogram tab instead of <body>.
  useEffect(() => {
    if (!histogramExpanded) return undefined;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.bottom-panel-tabs [role="tab"][aria-selected="true"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [histogramExpanded]);
  const chipShown = visible.histogramChip && !chipDismissed;
  const latticeHasCoords = Boolean(qecSnapshot?.coords.qubits.some((c) => c !== null));
  const vizHasContent = vizColumnHasContent(visible, { latticeHasCoords }, chipShown);
  const vizFits = topSplitSize.width === 0 || topSplitSize.width >= EDITOR_MIN_WIDTH + VIZ_MIN_WIDTH;
  // While Python boots the column is held open (with a placeholder) so the editor does not jump width when it is ready.
  const kernelStatus = useEditorStore((s) => s.kernelStatus);
  // A failed start keeps the column too (with a Retry), so the editor does not jump when the kernel recovers.
  const kernelReady = useEditorStore((s) => s.kernelReady);
  const lastRunNoCircuit = useSimulationStore((s) => s.lastRunNoCircuit);
  const placeholder = vizPlaceholder({ hasContent: vizHasContent, kernelStatus, kernelReady, isWeb: platform.getPlatform() === 'web', lastRunNoCircuit });
  const booting = placeholder === 'booting';
  const startFailed = placeholder === 'failed';
  const showViz = (vizHasContent || placeholder !== null) && vizFits;

  const diracOpen = useDiracPanelStore((s) => s.isOpen);
  const closeDirac = useDiracPanelStore((s) => s.close);
  const railTab = vizRailTab({ vizHasContent, vizFits, diracOpen, sidebarOpen: showSidebar });
  useRoomRetreat({ sidebarWidth, vizWanted: vizHasContent, canCollapseSidebar: !editorHidden && !fullViewOwnsArea, sidebarOpen: showSidebar });

  useShellLayout({
    platform,
    mode: workspaceMode,
    validViews: visibleActivityViews,
    canCollapseSidebar: !editorHidden,
  });

  useEffect(() => {
    // Fresh run should re-show a previously-dismissed histogram chip.
    if (result) resetRunArtifacts();
  }, [result, resetRunArtifacts]);

  useEffect(() => {
    if (uiMode === 'beginner' && result) setBottomCollapsed(false);
  }, [result, uiMode, setBottomCollapsed]);

  useEffect(() => {
    if (activeView && !visibleActivityViews.includes(activeView)) {
      setActiveView(features.explorerSidebar ? 'files' : null);
    }
    // visibleActivityViews is recomputed every render (new array identity);
    // depend on its inputs instead so this doesn't refire spuriously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, experimentalFeatures, workspaceMode, features.explorerSidebar]);

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
    setViewKeepingViewport(activeView && visibleActivityViews.includes(activeView) ? activeView : 'files', !editorHidden);
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

  // Cross-component navigation to Settings (the Dirac gear) now flows through
  // navigationStore.openSettings, which sets `activeView` and leaves any
  // full-view surface itself — no signal/effect needed here (PRD 11 Phase D).

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
    // Any other view: toggleView both selects (collapsing on re-click) and
    // leaves Learn/Challenge full-view surfaces (handled in the store).
    toggleView(view);
  };

  const effectiveBottomHeight = bottomCollapsed ? 28 : bottomHeight;

  return (
    <div
      style={{
        width: '100vw', height: '100vh',
        display: 'flex', flexDirection: 'column',
        backgroundColor: colors.bg,
        // clip, not hidden: `hidden` leaves the shell scrollable, so scrollIntoView could shift the whole app up.
        overflow: 'clip',
        userSelect: isDraggingH || isDraggingV ? 'none' : 'auto',
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Main area (everything except status bar) */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Activity Bar */}
        <ActivityBar
          active={activeView === 'settings' ? 'settings' : isChallengeMode ? 'challenges' : isLearnMode ? 'learning' : activeView}
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
        ) : (
          <>
            {/* Research takeovers (dev tools Phase 1 / PRD 09 Phase D) are now
                OVERLAID rather than swapped for the editor, so the editor stays
                mounted beneath them and never loses Monaco state (P4.1). */}
            {showQecWorkbench && (
              <div style={{
                flex: 1, minWidth: 0, overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
                animation: 'nuclei-fade-in 200ms ease',
              }}>
                <Suspense fallback={null}>
                  {/* Web build: the Workbench needs the desktop data engine, so the
                      QEC rail item opens the CSV-driven analysis view instead. */}
                  {isWebBuild() ? <QecAnalysisView /> : <QecWorkbench />}
                </Suspense>
              </div>
            )}
            {showTranspilerMain && (
              <div style={{
                flex: 1, minWidth: 0, overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
                animation: 'nuclei-fade-in 200ms ease',
              }}>
                <Suspense fallback={null}>
                  <TranspilerExplorer />
                </Suspense>
              </div>
            )}
            {showExperimentsMain && (
              <div style={{
                flex: 1, minWidth: 0, overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
                animation: 'nuclei-fade-in 200ms ease',
              }}>
                <ExperimentBreadcrumbs />
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                  <Suspense fallback={null}>
                    {selectedIsCampaign ? (
                      <QecAnalysisView />
                    ) : compareOpen ? (
                      <CompareView />
                    ) : selectedRunDir ? (
                      <RunDetail />
                    ) : (
                      <RunsTable />
                    )}
                  </Suspense>
                </div>
              </div>
            )}

            {/* Editor + Viz area — ALWAYS mounted; hidden (not unmounted) during
                a Research takeover so Monaco keeps per-tab models/undo/cursor. */}
            <div style={{ flex: 1, display: editorHidden ? 'none' : 'flex', flexDirection: 'column', minWidth: 0 }}>
              {/* Top: editor area + visualization */}
              <div ref={setTopSplitRef} style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                {/* Left: Editor with tabs + breadcrumbs + launch strip */}
                <div style={{
                  width: showViz ? `${editorPaneWidth}%` : '100%',
                  minWidth: showViz ? EDITOR_MIN_WIDTH : 0,
                  display: 'flex', flexDirection: 'column',
                  transition: isDraggingH ? 'none' : 'width var(--duration-normal) var(--ease-standard)',
                }}>
                  <EditorTabs />
                  <KernelBanner />
                  <Breadcrumbs />
                  {features.launchHardware && (
                    <ErrorBoundary label="Launch Strip">
                      <LaunchStrip />
                    </ErrorBoundary>
                  )}
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <ErrorBoundary label="Code Editor">
                      <QuantumEditor />
                    </ErrorBoundary>
                  </div>
                </div>

                {railTab && (
                  <button
                    type="button"
                    className="viz-rail"
                    onClick={() => (railTab.action === 'foldDirac' ? closeDirac() : setActiveView(null))}
                    aria-label={railTab.ariaLabel}
                  >
                    <span className="viz-rail__label">CIRCUIT</span>
                  </button>
                )}

                {showViz && (
                  <>
                    {/* Resize handle between editor and viz */}
                    <ResizeHandle
                      direction="horizontal"
                      isDragging={isDraggingH}
                      onMouseDown={() => setIsDraggingH(true)}
                      onDoubleClick={() => setEditorPaneWidth(DEFAULT_EDITOR_PANE_WIDTH)}
                    />

                    {/* Right rail (viz zone). Registry-driven (PRD 10 Phase D):
                        the circuit diagram + Bloch sphere for circuit-model
                        frameworks, the QEC panels for stim. */}
                    <div style={{ flex: 1, minWidth: VIZ_MIN_WIDTH, display: 'flex', flexDirection: 'column' }}>
                      <VizZone
                        visible={visible}
                        booting={booting}
                        startFailed={startFailed}
                        noCircuit={placeholder === 'noCircuit'}
                        chip={
                          <PanelReveal when={chipShown} from="bottom">
                            <div style={{ padding: '6px 10px 10px', flexShrink: 0 }}>
                              <HardwareAwareHistogramChip
                                simProbabilities={result ? sampledProbabilities(result) : null}
                                onDismiss={dismissChip}
                                onExpand={expandHistogram}
                              />
                            </div>
                          </PanelReveal>
                        }
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Bottom panel */}
              {shouldRenderBottomPanel({ panelVisible: showBottomPanel, hasResult: !!result, hasOutput: hasMeaningfulOutput(terminalOutput) }) && (
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

            {/* Dirac side panel (Code Mode only — hidden during a Research
                takeover, matching the pre-P4.1 behavior). */}
            {!editorHidden && (
              <div style={{ display: 'contents' }} data-feature-agent={features.agentEntry ? 'on' : 'off'}>
                <DiracSidePanel />
              </div>
            )}
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
export function ModeAnnouncer() {
  const announcement = useModeSwitchStore((s) => s.announcement);
  return (
    <div aria-live="polite" aria-atomic="true" className="nuclei-sr-only">
      {announcement}
    </div>
  );
}
