import { lazy, Suspense, useRef, useCallback, useMemo } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { FileExplorer } from '../explorer/FileExplorer';
import { OpenFilesSection } from '../explorer/OpenFilesSection';
import { LaunchPortal } from '../hardware/LaunchPortal';
import { SettingsPanel } from '../settings/SettingsPanel';
import type { ActivityView } from './ActivityBar';
import { createPlatformQecStudyFs, createTauriQecStudyFs } from '../../services/qecStudyFs';
import { usePlatform } from '../../platform/PlatformProvider';

import { LANDING_PROPS } from '../../hooks/useLandingRef';
import { TYPOGRAPHY } from '../../styles/tokens';
import { TextInput } from '../ui';
const LearningPathSidebar = lazy(async () => ({
  default: (await import('../learning/LearningPathSidebar')).LearningPathSidebar,
}));
const PluginMarketplace = lazy(async () => ({
  default: (await import('../plugins/PluginMarketplace')).PluginMarketplace,
}));
const HardwarePanel = lazy(async () => ({
  default: (await import('../hardware/HardwarePanel')).HardwarePanel,
}));
const CommunityPanel = lazy(async () => ({
  default: (await import('../community/CommunityPanel')).CommunityPanel,
}));
const ExperimentsPanel = lazy(async () => ({
  default: (await import('../experiments/ExperimentsPanel')).ExperimentsPanel,
}));
const EstimatorPanel = lazy(async () => ({
  default: (await import('../qec/EstimatorPanel')).EstimatorPanel,
}));
const TranspilerControls = lazy(async () => ({
  default: (await import('../transpiler/TranspilerControls')).TranspilerControls,
}));
const DiscoverySidebar = lazy(async () => ({
  default: (await import('../discovery/DiscoverySidebar')).DiscoverySidebar,
}));
const TrainabilitySidebar = lazy(async () => ({
  default: (await import('../trainability/TrainabilitySidebar')).TrainabilitySidebar,
}));
const QecStudySidebar = lazy(async () => ({
  default: (await import('../qec/workbench/QecStudySidebar')).QecStudySidebar,
}));

interface SidebarProps {
  view: ActivityView;
  width: number;
  onWidthChange: (w: number) => void;
}

function SearchPanel() {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <TextInput size="sm" placeholder="Search files..." aria-label="Search files" />
      <div style={{ color: colors.textDim, fontSize: 11, fontFamily: TYPOGRAPHY.fontSans, textAlign: 'center', marginTop: 16 }}>
        Type to search across files
      </div>
    </div>
  );
}

function CircuitInfoPanel() {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div style={{ padding: 12, color: colors.textMuted, fontSize: 12, fontFamily: TYPOGRAPHY.fontSans }}>
      <h3 className="nuclei-overline" style={{ marginBottom: 8 }}>Circuit Info</h3>
      <div style={{ color: colors.textDim, fontSize: 11 }}>
        Run a simulation to see circuit details here.
      </div>
    </div>
  );
}



function SidebarHeader({ title }: { title: string }) {
  return (
    <div className="nuclei-pane-header">
      <h2 className="nuclei-pane-header__title nuclei-overline" {...LANDING_PROPS}>{title}</h2>
    </div>
  );
}

function SidebarSuspense({ children }: { children: React.ReactNode }) {
  const colors = useThemeStore((s) => s.colors);

  return (
    <Suspense fallback={(
      <div style={{
        padding: 16,
        color: colors.textDim,
        fontSize: 12,
        fontFamily: TYPOGRAPHY.fontSans,
      }}>
        Loading…
      </div>
    )}>
      {children}
    </Suspense>
  );
}

const VIEW_TITLES: Record<ActivityView, string> = {
  files: 'Explorer',
  search: 'Search',
  circuit: 'Circuit',
  learning: 'Learning',
  challenges: 'Challenges',
  plugins: 'Plugins',
  hardware: 'Hardware',
  launch: 'Launch',
  community: 'Community',
  settings: 'Settings',
  experiments: 'Experiments',
  qec: 'QEC Workbench',
  estimator: 'Resource Estimator',
  transpiler: 'Transpiler',
  discovery: 'Discovery Engine',
  trainability: 'Trainability Lab',
};

export function Sidebar({ view, width, onWidthChange }: SidebarProps) {
  const colors = useThemeStore((s) => s.colors);
  const platform = usePlatform();
  const qecStudyFs = useMemo(
    () => platform.getPlatform() === 'web'
      ? createPlatformQecStudyFs(platform)
      : createTauriQecStudyFs(),
    [platform],
  );
  const isDragging = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = width;

    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = startWidth + (e.clientX - startX);
      onWidthChange(Math.max(180, Math.min(400, newWidth)));
    };
    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width, onWidthChange]);

  return (
    <div data-tour-sidebar="" style={{
      width, height: '100%',
      backgroundColor: colors.bg,
      display: 'flex', flexDirection: 'column',
      flexShrink: 0, position: 'relative',
      borderRight: `1px solid ${colors.border}`,
    }}>
      <SidebarHeader title={VIEW_TITLES[view]} />
      {/* Open Files sits OUTSIDE the scroll container so it stays pinned at
          the top of the Explorer regardless of how deep the tree is scrolled.
          Rendered only for the files view; self-hides when there are no open
          tabs so it doesn't add empty chrome. */}
      {view === 'files' && <OpenFilesSection />}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {/* Visibility is decided upstream by the activity-bar registry
            (mode + developer flag) — a view can only be active if the rail
            offered it, so the Sidebar renders it unconditionally (PRD 11
            Phase C removed the per-view developer-flag conjunction gates). */}
        {view === 'files' && <FileExplorer />}
        {view === 'launch' && <LaunchPortal />}
        {view === 'search' && <SearchPanel />}
        {view === 'circuit' && <CircuitInfoPanel />}
        {view === 'learning' && (
          <SidebarSuspense>
            <LearningPathSidebar />
          </SidebarSuspense>
        )}
        {view === 'plugins' && (
          <SidebarSuspense>
            <PluginMarketplace />
          </SidebarSuspense>
        )}
        {view === 'hardware' && (
          <SidebarSuspense>
            <HardwarePanel />
          </SidebarSuspense>
        )}
        {view === 'community' && (
          <SidebarSuspense>
            <CommunityPanel />
          </SidebarSuspense>
        )}
        {view === 'settings' && <SettingsPanel />}
        {view === 'experiments' && (
          <SidebarSuspense>
            <ExperimentsPanel />
          </SidebarSuspense>
        )}
        {view === 'qec' && (
          <SidebarSuspense>
            <QecStudySidebar fs={qecStudyFs} />
          </SidebarSuspense>
        )}
        {view === 'estimator' && (
          <SidebarSuspense>
            <EstimatorPanel />
          </SidebarSuspense>
        )}
        {view === 'transpiler' && (
          <SidebarSuspense>
            <TranspilerControls />
          </SidebarSuspense>
        )}
        {view === 'discovery' && (
          <SidebarSuspense>
            <DiscoverySidebar />
          </SidebarSuspense>
        )}
        {view === 'trainability' && (
          <SidebarSuspense>
            <TrainabilitySidebar />
          </SidebarSuspense>
        )}
      </div>

      {/* Resize handle on right edge */}
      <div
        style={{
          position: 'absolute', right: -3, top: 0, bottom: 0,
          width: 6, cursor: 'col-resize', zIndex: 5,
        }}
        onMouseDown={handleResizeStart}
      />
    </div>
  );
}
