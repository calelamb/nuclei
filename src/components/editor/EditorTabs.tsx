import { useCallback, useRef, useState } from 'react';
import { FileCode, ChevronDown } from 'lucide-react';
import { useProjectStore } from '../../stores/projectStore';
import { useThemeStore } from '../../stores/themeStore';
import { useExperimentStore } from '../../services/experimentStore';
import { expandGrid } from '../../types/experiment';
import { FrameworkSelector } from './FrameworkSelector';
import { EditorTabStrip } from './EditorTabStrip';
import { RunControls } from './RunControls';
import { editorFileKind } from './editorFileKind';
import { tabBarDensity, type TabBarDensity } from './tabBarLayout';
import { RunButton } from '../experiments/RunButton';
import { Button, Menu, type MenuEntry } from '../ui';
import { focusTabForPath } from './focusTab';
import { useUiFeatures } from '../../hooks/useUiFeatures';

const basename = (p: string) => p.split('/').pop() ?? p;

/**
 * The editor toolbar: open-file tabs on the left, then the framework chip and the
 * Launch/Run slot. Framework, Launch and Run only appear for files they apply to;
 * an experiment manifest gets the experiment Run control instead.
 */
export function EditorTabs() {
  const tabs = useProjectStore((s) => s.tabs);
  const activeTabPath = useProjectStore((s) => s.activeTabPath);
  const setActiveTab = useProjectStore((s) => s.setActiveTab);
  const projectRoot = useProjectStore((s) => s.projectRoot);
  const experiments = useExperimentStore((s) => s.experiments);
  const colors = useThemeStore((s) => s.colors);
  const features = useUiFeatures();

  const barRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [density, setDensity] = useState<TabBarDensity>('full');
  const [overflowing, setOverflowing] = useState(false);

  const measure = useCallback(() => {
    const bar = barRef.current;
    if (bar) setDensity(tabBarDensity(bar.clientWidth));
  }, []);

  const kind = editorFileKind(tabs.length === 0 ? null : activeTabPath);
  const experiment = kind === 'experiment' && activeTabPath
    ? experiments.find((e) => e.path === activeTabPath || e.fileName === basename(activeTabPath))
    : undefined;

  const overflowEntries: MenuEntry[] = tabs.map((t) => ({
    id: t.path,
    label: basename(t.path),
    icon: <FileCode size={12} />,
    hint: t.isDirty ? <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: colors.warning }} role="img" aria-label="Unsaved changes" /> : undefined,
    checked: t.path === activeTabPath,
    onSelect: () => { setActiveTab(t.path); focusTabForPath(t.path); },
  }));

  return (
    <div
      ref={barRef}
      style={{
        height: 40, display: 'flex', alignItems: 'stretch', backgroundColor: colors.bgPanel,
        borderBottom: `1px solid ${colors.border}`, flexShrink: 0, overflow: 'hidden', paddingRight: 8, gap: 8,
      }}
    >
      <EditorTabStrip stripRef={stripRef} onMeasure={measure} onOverflowing={setOverflowing} />

      {overflowing && tabs.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <Menu
            label="Open files"
            placement="bottom-end"
            minWidth={220}
            entries={overflowEntries}
            trigger={(p) => (
              <Button {...p} size="md" aria-label={`Show all ${tabs.length} open files`} icon={<ChevronDown size={12} />}>
                {tabs.length}
              </Button>
            )}
          />
        </div>
      )}

      {kind === 'runnable' && features.frameworkPicker && (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <FrameworkSelector compact={density !== 'full'} />
        </div>
      )}

      {kind === 'runnable' && <RunControls density={density} />}
      {kind === 'experiment' && experiment && projectRoot && (
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <RunButton
            experiment={experiment}
            projectRoot={projectRoot}
            pointCount={experiment.spec.type !== 'qec_campaign' ? expandGrid(experiment.spec.sweep).length : 0}
          />
        </div>
      )}
    </div>
  );
}
