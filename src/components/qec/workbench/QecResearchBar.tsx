import { Play } from 'lucide-react';
import type { ReactElement } from 'react';
import { useQecStudyStore } from '../../../services/qecStudyStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import type { QecWorkspacePreset } from '../../../types/qecStudy';
import { ResearchTrail } from './ResearchTrail';

const PRESETS: readonly QecWorkspacePreset[] = ['build', 'analyze', 'observe'];

function presetLabel(preset: QecWorkspacePreset): string {
  return `${preset.charAt(0).toUpperCase()}${preset.slice(1)}`;
}

function StudyPicker(): ReactElement {
  const studies = useQecStudyStore((state) => state.studies);
  const activeStudyId = useQecStudyUiStore((state) => state.activeStudyId);
  const setActiveStudy = useQecStudyUiStore((state) => state.setActiveStudy);
  const clearActiveStudy = useQecStudyUiStore((state) => state.clearActiveStudy);
  const updateStudy = (studyId: string): void => {
    if (studyId) setActiveStudy(studyId);
    else clearActiveStudy();
  };
  return (
    <label className="qec-study-picker" htmlFor="qec-active-study">
      <span>Study</span>
      <select
        id="qec-active-study"
        aria-label="Active QEC Study"
        disabled={studies.length === 0}
        value={activeStudyId ?? ''}
        onChange={(event) => updateStudy(event.target.value)}
      >
        <option value="">{studies.length === 0 ? 'No Studies available' : 'Select a Study'}</option>
        {studies.map(({ study }) => <option key={study.id} value={study.id}>{study.name}</option>)}
      </select>
    </label>
  );
}

function PresetSwitcher(): ReactElement {
  const preset = useQecWorkbenchStore((state) => state.preset);
  const setPreset = useQecWorkbenchStore((state) => state.setPreset);
  return (
    <div className="qec-preset-switcher" role="group" aria-label="Workspace preset">
      {PRESETS.map((option) => (
        <button key={option} type="button" aria-pressed={preset === option} onClick={() => setPreset(option)}>
          {presetLabel(option)}
        </button>
      ))}
    </div>
  );
}

function DeferredRunAction(): ReactElement {
  return (
    <button type="button" className="qec-primary-action" aria-label="Run or capture (not connected)" title="Run and capture controls connect in a later workbench task" disabled>
      <Play aria-hidden="true" size={15} fill="currentColor" />
      Run / Capture
    </button>
  );
}

function ResearchContext(): ReactElement {
  return (
    <div className="qec-research-bar__context">
      <p className="qec-research-bar__metadata">
        <span className="qec-mono">Revision —</span>
        <span className="qec-mono">Data —</span>
        <span className="qec-status qec-status--ready">Provenance ready</span>
      </p>
      <ResearchTrail />
    </div>
  );
}

export function QecResearchBar(): ReactElement {
  return (
    <header className="qec-research-bar">
      <div className="qec-research-bar__primary">
        <StudyPicker />
        <PresetSwitcher />
        <DeferredRunAction />
      </div>
      <ResearchContext />
    </header>
  );
}
