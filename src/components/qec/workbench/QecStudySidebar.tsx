import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { AlertTriangle, BookOpen, Plus } from 'lucide-react';
import { useQecStudyStore, type DiscoveredQecStudy } from '../../../services/qecStudyStore';
import type { QecStudyFs } from '../../../services/qecStudyFs';
import { useProjectStore } from '../../../stores/projectStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import { useThemeStore, type ThemeColors } from '../../../stores/themeStore';
import {
  qecStudySchema,
  type QecStudy,
  type QecWorkspacePreset,
} from '../../../types/qecStudy';

interface QecStudySidebarProps {
  fs: QecStudyFs;
}

interface StudyDraft {
  name: string;
  question: string;
  preset: QecWorkspacePreset;
}

type DraftResult = { study: QecStudy; error: null } | { study: null; error: string };

const EMPTY_DRAFT: StudyDraft = { name: '', question: '', preset: 'build' };

function studyId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function validateDraft(draft: StudyDraft): DraftResult {
  if (!draft.name.trim()) return { study: null, error: 'Enter a Study name before creating it.' };
  if (!draft.question.trim()) return { study: null, error: 'Enter a research question before creating the Study.' };
  const parsed = qecStudySchema.safeParse({
    schema: 1,
    id: studyId(draft.name),
    name: draft.name.trim(),
    question: draft.question.trim(),
    preset: draft.preset,
    tags: [],
    sources: [],
  });
  if (parsed.success) return { study: parsed.data, error: null };
  return { study: null, error: 'Use a Study name containing at least one letter or number.' };
}

function StudyList({ studies, busy }: { studies: readonly DiscoveredQecStudy[]; busy: boolean }): ReactElement {
  const activeStudyId = useQecStudyUiStore((state) => state.activeStudyId);
  const setActiveStudy = useQecStudyUiStore((state) => state.setActiveStudy);
  const colors = useThemeStore((state) => state.colors);
  if (studies.length === 0) {
    return <p style={{ color: colors.textDim, fontSize: 11, margin: '6px 0' }}>No Studies in this project yet.</p>;
  }
  return (
    <div style={{ display: 'grid', gap: 5 }}>
      {studies.map(({ study }) => (
        <button key={study.id} type="button" disabled={busy} aria-pressed={activeStudyId === study.id} onClick={() => setActiveStudy(study.id)} style={{ padding: '7px 8px', borderRadius: 4, border: `1px solid ${activeStudyId === study.id ? colors.accent : colors.border}`, background: activeStudyId === study.id ? `${colors.accent}18` : colors.bgElevated, color: colors.text, textAlign: 'left', cursor: busy ? 'wait' : 'pointer' }}>
          <strong style={{ display: 'block', fontSize: 11 }}>{study.name}</strong>
          <span style={{ display: 'block', color: colors.textDim, fontSize: 10, marginTop: 2 }}>{study.question}</span>
        </button>
      ))}
    </div>
  );
}

function ValidationCards({ colors }: { colors: ThemeColors }): ReactElement | null {
  const validationErrors = useQecStudyStore((state) => state.validationErrors);
  if (validationErrors.length === 0) return null;
  return (
    <section aria-label="Study validation errors" style={{ display: 'grid', gap: 6 }}>
      {validationErrors.map(({ fileName, errors }) => (
        <article key={fileName} style={{ border: `1px solid ${colors.warning}60`, borderRadius: 4, padding: 8, background: `${colors.warning}0d` }}>
          <strong style={{ color: colors.warning, fontSize: 10 }}>{fileName}</strong>
          {errors.map((error) => <p key={error} style={{ color: colors.textMuted, fontSize: 10, lineHeight: 1.4, margin: '4px 0 0' }}>{error}</p>)}
        </article>
      ))}
    </section>
  );
}

interface StudyFormProps {
  busy: boolean;
  submitting: boolean;
  draft: StudyDraft;
  error: string | null;
  onChange: (draft: StudyDraft) => void;
  onSubmit: (event: FormEvent) => void;
}

function StudyForm({ busy, submitting, draft, error, onChange, onSubmit }: StudyFormProps): ReactElement {
  const colors = useThemeStore((state) => state.colors);
  const controlStyle = { width: '100%', boxSizing: 'border-box' as const, border: `1px solid ${colors.border}`, borderRadius: 4, background: colors.bg, color: colors.text, padding: '6px 7px', fontSize: 11 };
  return (
    <form onSubmit={onSubmit} style={{ display: 'grid', gap: 7 }}>
      <input aria-label="Study name" placeholder="Study name" value={draft.name} disabled={busy} onChange={(event) => onChange({ ...draft, name: event.target.value })} style={controlStyle} />
      <textarea aria-label="Research question" placeholder="Research question" value={draft.question} disabled={busy} onChange={(event) => onChange({ ...draft, question: event.target.value })} rows={3} style={{ ...controlStyle, resize: 'vertical' }} />
      <select aria-label="Workspace preset" value={draft.preset} disabled={busy} onChange={(event) => onChange({ ...draft, preset: event.target.value as QecWorkspacePreset })} style={controlStyle}>
        <option value="build">Build</option><option value="analyze">Analyze</option><option value="observe">Observe</option>
      </select>
      {error && <div role="alert" style={{ color: colors.error, fontSize: 10, lineHeight: 1.4 }}><AlertTriangle size={11} /> {error}</div>}
      <button type="submit" className="qec-study-create-button" disabled={busy} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5, border: 0, borderRadius: 4, padding: '7px 8px', background: colors.accent, color: colors.bg, fontSize: 11, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
        <Plus size={12} />{submitting ? 'Creating Study…' : 'Create Study'}
      </button>
    </form>
  );
}

function useStudyLifecycle(projectRoot: string | null, fs: QecStudyFs): void {
  const reload = useQecStudyStore((state) => state.reload);
  const startWatching = useQecStudyStore((state) => state.startWatching);
  const stopWatching = useQecStudyStore((state) => state.stopWatching);
  const clearStudies = useQecStudyStore((state) => state.clear);
  useEffect(() => {
    let current = true;
    const synchronize = async (): Promise<void> => {
      if (!projectRoot) {
        clearStudies();
        return;
      }
      await reload(projectRoot, fs);
      if (current) await startWatching(projectRoot, fs);
    };
    void synchronize();
    return () => {
      current = false;
      stopWatching();
    };
  }, [clearStudies, fs, projectRoot, reload, startWatching, stopWatching]);
}

export function QecStudySidebar({ fs }: QecStudySidebarProps): ReactElement {
  const projectRoot = useProjectStore((state) => state.projectRoot);
  const studies = useQecStudyStore((state) => state.studies);
  const loading = useQecStudyStore((state) => state.loading);
  const create = useQecStudyStore((state) => state.create);
  const setActiveStudy = useQecStudyUiStore((state) => state.setActiveStudy);
  const colors = useThemeStore((state) => state.colors);
  const [draft, setDraft] = useState<StudyDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useStudyLifecycle(projectRoot, fs);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!projectRoot) return setError('Open a project before creating a Study.');
    const validated = validateDraft(draft);
    if (!validated.study) return setError(validated.error);
    setError(null);
    setSubmitting(true);
    try {
      await create(projectRoot, validated.study, fs);
      setActiveStudy(validated.study.id);
      setDraft(EMPTY_DRAFT);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not create the Study. Try again.');
    } finally {
      setSubmitting(false);
    }
  };
  if (!projectRoot) return <p style={{ color: colors.textDim, fontSize: 11, padding: 12 }}>Open a project to manage QEC Studies.</p>;
  return (
    <div style={{ display: 'grid', gap: 12, padding: 10, fontFamily: "'Geist Sans', sans-serif" }}>
      <section aria-label="QEC Studies"><div style={{ display: 'flex', gap: 5, alignItems: 'center', color: colors.textMuted, fontSize: 10, fontWeight: 600, marginBottom: 6 }}><BookOpen size={12} />STUDIES</div><StudyList studies={studies} busy={loading || submitting} /></section>
      <ValidationCards colors={colors} />
      <section aria-label="Create Study"><div style={{ color: colors.textMuted, fontSize: 10, fontWeight: 600, marginBottom: 6 }}>NEW STUDY</div><StudyForm busy={loading || submitting} submitting={submitting} draft={draft} error={error} onChange={setDraft} onSubmit={(event) => void submit(event)} /></section>
    </div>
  );
}
