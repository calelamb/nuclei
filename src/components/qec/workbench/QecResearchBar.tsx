import { ChevronDown, Play } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useQecStudyStore } from '../../../services/qecStudyStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import type { QecWorkspacePreset } from '../../../types/qecStudy';
import { ResearchTrail } from './ResearchTrail';

const PRESETS: readonly QecWorkspacePreset[] = ['build', 'analyze', 'observe'];

function presetLabel(preset: QecWorkspacePreset): string {
  return `${preset.charAt(0).toUpperCase()}${preset.slice(1)}`;
}

export function QecResearchBar(): ReactElement {
  const [studyMenuOpen, setStudyMenuOpen] = useState(false);
  const studies = useQecStudyStore((state) => state.studies);
  const activeStudyId = useQecStudyUiStore((state) => state.activeStudyId);
  const setActiveStudy = useQecStudyUiStore((state) => state.setActiveStudy);
  const preset = useQecWorkbenchStore((state) => state.preset);
  const setPreset = useQecWorkbenchStore((state) => state.setPreset);
  const activeStudy = studies.find(({ study }) => study.id === activeStudyId)?.study ?? null;

  const chooseStudy = (studyId: string): void => {
    setActiveStudy(studyId);
    setStudyMenuOpen(false);
  };

  return (
    <header className="qec-research-bar">
      <div className="qec-research-bar__primary">
        <div className="qec-study-picker">
          <button
            type="button"
            className="qec-study-picker__trigger"
            aria-expanded={studyMenuOpen}
            aria-haspopup="listbox"
            onClick={() => setStudyMenuOpen((open) => !open)}
          >
            <span>Study: {activeStudy?.name ?? 'None selected'}</span>
            <ChevronDown aria-hidden="true" size={15} strokeWidth={1.8} />
          </button>
          {studyMenuOpen && (
            <ul className="qec-study-picker__menu" role="listbox" aria-label="Available QEC Studies">
              {studies.length > 0 ? studies.map(({ study }) => (
                <li key={study.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={study.id === activeStudyId}
                    onClick={() => chooseStudy(study.id)}
                  >
                    <span>{study.name}</span>
                    <span className="qec-mono">{study.preset}</span>
                  </button>
                </li>
              )) : (
                <li className="qec-study-picker__empty">No Studies in this project</li>
              )}
            </ul>
          )}
        </div>

        <div className="qec-preset-switcher" role="group" aria-label="Workspace preset">
          {PRESETS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={preset === option}
              onClick={() => setPreset(option)}
            >
              {presetLabel(option)}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="qec-primary-action"
          aria-label="Run or capture (not connected)"
          title="Run and capture controls connect in a later workbench task"
          disabled
        >
          <Play aria-hidden="true" size={15} fill="currentColor" />
          Run / Capture
        </button>
      </div>

      <div className="qec-research-bar__context">
        <p className="qec-research-bar__metadata">
          <span className="qec-mono">Revision —</span>
          <span className="qec-mono">Data —</span>
          <span className="qec-status qec-status--ready">Provenance ready</span>
        </p>
        <ResearchTrail />
      </div>
    </header>
  );
}
