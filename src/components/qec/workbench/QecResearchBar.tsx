import { Select } from '../../ui/Select';
import { SegmentedControl } from '../../ui/SegmentedControl';
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
      <Select
        size="md"
        className="qec-study-select"
        id="qec-active-study"
        aria-label="Active QEC Study"
        disabled={studies.length === 0}
        value={activeStudyId ?? ''}
        onChange={(event) => updateStudy(event.target.value)}
      >
        <option value="">{studies.length === 0 ? 'No Studies available' : 'Select a Study'}</option>
        {studies.map(({ study }) => <option key={study.id} value={study.id}>{study.name}</option>)}
      </Select>
    </label>
  );
}

const PRESET_OPTIONS = PRESETS.map((value) => ({ value, label: presetLabel(value) }));

function PresetSwitcher(): ReactElement {
  const preset = useQecWorkbenchStore((state) => state.preset);
  const setPreset = useQecWorkbenchStore((state) => state.setPreset);
  return <SegmentedControl aria-label="Workspace preset" value={preset} options={PRESET_OPTIONS} onChange={setPreset} />;
}

function ResearchContext(): ReactElement {
  return (
    <div className="qec-research-bar__context">
      <p className="qec-research-bar__metadata">
        <span>Revision —</span>
        <span>Data —</span>
        <span className="qec-status qec-status--neutral">Provenance not evaluated</span>
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
      </div>
      <ResearchContext />
    </header>
  );
}
