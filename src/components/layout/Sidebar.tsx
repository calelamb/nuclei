import { lazy, Suspense, useState, useRef, useCallback, useMemo } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { FileExplorer } from '../explorer/FileExplorer';
import { OpenFilesSection } from '../explorer/OpenFilesSection';
import { LaunchPortal } from '../hardware/LaunchPortal';
import { SettingsPanel } from '../settings/SettingsPanel';
import type { ActivityView } from './ActivityBar';
import { createPlatformQecStudyFs, createTauriQecStudyFs } from '../../services/qecStudyFs';
import { usePlatform } from '../../platform/PlatformProvider';

const LearningPathSidebar = lazy(async () => ({
  default: (await import('../learning/LearningPathSidebar')).LearningPathSidebar,
}));
const VideoLibrary = lazy(async () => ({
  default: (await import('../learning/VideoLibrary')).VideoLibrary,
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
      <input
        placeholder="Search files..."
        aria-label="Search files"
        style={{
          width: '100%', padding: '6px 10px',
          fontSize: 12, fontFamily: "'Geist Sans', system-ui, sans-serif",
          background: colors.bg, border: `1px solid ${colors.border}`,
          borderRadius: 4, color: colors.text, outline: 'none',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = colors.accent; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = colors.border; }}
      />
      <div style={{ color: colors.textDim, fontSize: 11, fontFamily: "'Geist Sans', sans-serif", textAlign: 'center', marginTop: 16 }}>
        Type to search across files
      </div>
    </div>
  );
}

function CircuitInfoPanel() {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div style={{ padding: 12, color: colors.textMuted, fontSize: 12, fontFamily: "'Geist Sans', sans-serif" }}>
      <div style={{ color: colors.textDim, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Circuit Info
      </div>
      <div style={{ color: colors.textDim, fontSize: 11 }}>
        Run a simulation to see circuit details here.
      </div>
    </div>
  );
}



function SidebarHeader({ title }: { title: string }) {
  const colors = useThemeStore((s) => s.colors);
  return (
    <div style={{
      height: 32, display: 'flex', alignItems: 'center',
      padding: '0 12px', flexShrink: 0,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: 0.5, color: colors.textMuted,
        fontFamily: "'Geist Sans', sans-serif",
      }}>
        {title}
      </span>
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
        fontFamily: "'Geist Sans', sans-serif",
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
  estimator: 'Estimator',
  transpiler: 'Transpiler',
};

type LearningTab = 'tracks' | 'videos';

function LearningSidebarTabs() {
  const colors = useThemeStore((s) => s.colors);
  const [activeTab, setActiveTab] = useState<LearningTab>('tracks');

  const tabs: { key: LearningTab; label: string }[] = [
    { key: 'tracks', label: 'Tracks' },
    { key: 'videos', label: 'Videos' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        display: 'flex',
        borderBottom: `1px solid ${colors.border}`,
        flexShrink: 0,
      }}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                padding: '5px 0',
                background: 'transparent',
                border: 'none',
                borderBottom: isActive ? `2px solid ${colors.accent}` : '2px solid transparent',
                color: isActive ? colors.accent : colors.textDim,
                fontSize: 10,
                fontWeight: 600,
                fontFamily: "'Geist Sans', sans-serif",
                textTransform: 'uppercase',
                letterSpacing: 0.3,
                cursor: 'pointer',
                transition: 'color 150ms, border-color 150ms',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'tracks' ? <LearningPathSidebar /> : <VideoLibrary />}
      </div>
    </div>
  );
}

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
    <div style={{
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
            <LearningSidebarTabs />
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
