import { FlaskConical, GraduationCap } from 'lucide-react';
import { useWorkspaceStore, type WorkspaceMode } from '../../stores/workspaceStore';
import { useModeSwitchStore } from '../../stores/modeSwitchStore';
import { useResearchTourStore } from '../../stores/researchTourStore';
import { useHelpOverlayStore } from '../../stores/helpOverlayStore';
import { useWhatsNewStore } from '../../stores/whatsNewStore';
import { shortcutLabel } from '../../config/keybindings';
import { Button, SegmentedControl } from '../ui';
import { Section, SettingRow } from './SettingsPrimitives';

/** Switch Learn / Research and replay the orientation tour. */
export function WorkspaceSection() {
  const mode = useWorkspaceStore((s) => s.mode);
  // Through the in-flight-work guard, like the status-bar chip and the palette.
  const requestSwitch = useModeSwitchStore((s) => s.requestSwitch);
  const startTour = useResearchTourStore((s) => s.start);

  return (
    <Section id="workspace" title="Workspace" defaultOpen>
      <SettingRow label="Workspace mode" stacked hint={mode === 'learn' ? 'Lessons, challenges and Dirac as your tutor.' : 'Projects, experiments and Dirac as a terse collaborator.'}>
        <SegmentedControl<WorkspaceMode>
          aria-label="Workspace mode"
          value={mode}
          onChange={requestSwitch}
          options={[
            { value: 'learn', label: 'Learn', icon: <GraduationCap size={12} /> },
            { value: 'research', label: 'Research', icon: <FlaskConical size={12} /> },
          ]}
        />
      </SettingRow>
      {mode === 'research' && (
        <SettingRow label="Research tour" hint="A three-step walkthrough of the Research workspace.">
          <Button size="sm" onClick={startTour}>Replay</Button>
        </SettingRow>
      )}
    </Section>
  );
}

/** Shortcuts, release notes and the running version. */
export function HelpSection() {
  const openShortcuts = useHelpOverlayStore((s) => s.setShortcutsOpen);
  const openWhatsNew = useWhatsNewStore((s) => s.openWhatsNew);

  return (
    <Section id="help" title="Help">
      <SettingRow label="Keyboard shortcuts">
        <Button size="sm" onClick={() => openShortcuts(true)}>View {shortcutLabel('shortcuts')}</Button>
      </SettingRow>
      <SettingRow label="What's new" hint={`Nuclei v${__APP_VERSION__}`}>
        <Button size="sm" onClick={openWhatsNew}>Release notes</Button>
      </SettingRow>
    </Section>
  );
}
