import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from 'react';
import { AlertTriangle, BookOpen, Plus } from 'lucide-react';
import { useQecStudyStore, type DiscoveredQecStudy } from '../../../services/qecStudyStore';
import type { QecStudyFs } from '../../../services/qecStudyFs';
import { QecNoProjectNotice } from './QecNoProjectNotice';
import { useProjectStore } from '../../../stores/projectStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import { useThemeStore, type ThemeColors } from '../../../stores/themeStore';
import {
  qecStudySchema,
  type QecStudy,
  type QecWorkspacePreset,
} from '../../../types/qecStudy';

import { TYPOGRAPHY } from '../../../styles/tokens';
import { Button, Select, TextArea, TextInput } from '../../ui';
interface QecStudySidebarProps {
  fs: QecStudyFs;
}

interface StudyDraft {
  name: string;
  question: string;
  preset: QecWorkspacePreset;
}

type ErrorField = 'name' | 'question' | 'form';
interface FormError { field: ErrorField; message: string }
type DraftResult = { study: QecStudy; error: null } | { study: null; error: FormError };

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
  if (!draft.name.trim()) return { study: null, error: { field: 'name', message: 'Enter a name for the study.' } };
  if (!draft.question.trim()) return { study: null, error: { field: 'question', message: 'Enter the research question this study answers.' } };
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
  return { study: null, error: { field: 'name', message: 'Use a name with at least one letter or number.' } };
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
        <button key={study.id} type="button" disabled={busy} aria-pressed={activeStudyId === study.id} onClick={() => setActiveStudy(study.id)} style={{ padding: '7px 8px', borderRadius: 'var(--radius-xs)', border: `1px solid ${activeStudyId === study.id ? colors.accent : colors.border}`, background: activeStudyId === study.id ? `${colors.accent}18` : colors.bgElevated, color: colors.text, textAlign: 'left', cursor: busy ? 'wait' : 'pointer' }}>
          <strong style={{ display: 'block', fontSize: 11 }}>{study.name}</strong>
          <span style={{ display: 'block', color: colors.textDim, fontSize: 11, marginTop: 2 }}>{study.question}</span>
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
        <article key={fileName} style={{ border: `1px solid ${colors.warning}60`, borderRadius: 'var(--radius-xs)', padding: 8, background: `${colors.warning}0d` }}>
          <strong style={{ color: colors.warning, fontSize: 11 }}>{fileName}</strong>
          {errors.map((error) => <p key={error} style={{ color: colors.textMuted, fontSize: 11, lineHeight: 1.4, margin: '4px 0 0' }}>{error}</p>)}
        </article>
      ))}
    </section>
  );
}

interface StudyFormProps {
  busy: boolean;
  submitting: boolean;
  draft: StudyDraft;
  error: FormError | null;
  onChange: (draft: StudyDraft) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}

interface FieldProps {
  id: string;
  label: string;
  error?: string;
  children: ReactElement;
}

/** A visible label above its control, with the control's own error underneath, wired for assistive tech. */
function FormField({ id, label, error, children }: FieldProps): ReactElement {
  const colors = useThemeStore((state) => state.colors);
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <label htmlFor={id} style={{ color: colors.text, fontSize: 12, fontWeight: 600 }}>{label}</label>
      {children}
      {error && <div id={`${id}-error`} role="alert" style={{ color: colors.error, fontSize: 11, lineHeight: 1.4 }}><AlertTriangle size={12} /> {error}</div>}
    </div>
  );
}

function StudyForm({ busy, submitting, draft, error, onChange, onSubmit, onCancel }: StudyFormProps): ReactElement {
  const colors = useThemeStore((state) => state.colors);
  const errorFor = (field: ErrorField): string | undefined => (error?.field === field ? error.message : undefined);
  const describe = (field: ErrorField): { 'aria-describedby'?: string; invalid: boolean } => ({
    invalid: errorFor(field) !== undefined,
    'aria-describedby': errorFor(field) ? `qec-study-${field}-error` : undefined,
  });
  return (
    <form onSubmit={onSubmit} onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Escape' && !submitting) { event.stopPropagation(); onCancel(); } }} style={{ display: 'grid', gap: 10 }}>
      <FormField id="qec-study-name" label="Study name" error={errorFor('name')}>
        <TextInput id="qec-study-name" autoFocus value={draft.name} disabled={busy} {...describe('name')} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
      </FormField>
      <FormField id="qec-study-question" label="Research question" error={errorFor('question')}>
        <TextArea id="qec-study-question" value={draft.question} disabled={busy} {...describe('question')} onChange={(event) => onChange({ ...draft, question: event.target.value })} rows={3} />
      </FormField>
      <FormField id="qec-study-preset" label="Starting preset">
        <Select id="qec-study-preset" value={draft.preset} disabled={busy} onChange={(event) => onChange({ ...draft, preset: event.target.value as QecWorkspacePreset })}>
          <option value="build">Build</option><option value="analyze">Analyze</option><option value="observe">Observe</option>
        </Select>
      </FormField>
      {error?.field === 'form' && <div role="alert" style={{ color: colors.error, fontSize: 11, lineHeight: 1.4 }}><AlertTriangle size={12} /> {error.message}</div>}
      <Button type="submit" variant="primary" className="qec-study-create-button" disabled={busy} loading={submitting} icon={submitting ? undefined : <Plus size={12} />}>
        {submitting ? 'Creating study…' : 'Create study'}
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={onCancel}>Cancel</Button>
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
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const newStudyRef = useRef<HTMLButtonElement>(null);
  // Where focus goes once the form unmounts: the form's own buttons disappear, so hand it on.
  const pendingFocus = useRef<'new-study' | 'created-row' | null>(null);
  useStudyLifecycle(projectRoot, fs);
  useEffect(() => {
    if (creating || pendingFocus.current === null) return;
    const target = pendingFocus.current === 'new-study'
      ? newStudyRef.current
      : document.querySelector<HTMLElement>('[aria-label="QEC Studies"] button[aria-pressed="true"]');
    pendingFocus.current = null;
    (target ?? newStudyRef.current)?.focus();
  }, [creating, studies]);
  const closeForm = (focus: 'new-study' | 'created-row'): void => {
    pendingFocus.current = focus;
    setCreating(false);
  };
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!projectRoot) return setError({ field: 'form', message: 'Open a project before creating a study.' });
    const validated = validateDraft(draft);
    if (!validated.study) return setError(validated.error);
    setError(null);
    setSubmitting(true);
    try {
      await create(projectRoot, validated.study, fs);
      setActiveStudy(validated.study.id);
      setDraft(EMPTY_DRAFT);
      setAnnouncement(`Study created: ${validated.study.name}`);
      closeForm('created-row');
    } catch (cause: unknown) {
      setError({ field: 'form', message: cause instanceof Error ? cause.message : 'Could not create the study. Try again.' });
    } finally {
      setSubmitting(false);
    }
  };
  if (!projectRoot) return <QecNoProjectNotice />;
  return (
    <div style={{ display: 'grid', gap: 12, padding: 10, fontFamily: TYPOGRAPHY.fontSans }}>
      <section aria-label="QEC Studies"><div style={{ display: 'flex', gap: 5, alignItems: 'center', color: colors.textMuted, fontSize: 12, fontWeight: 500, marginBottom: 6 }}><BookOpen size={12} />Studies</div><StudyList studies={studies} busy={loading || submitting} /></section>
      <ValidationCards colors={colors} />
      <div role="status" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{announcement}</div>
      <section aria-label="Create study">
        {creating
          ? <StudyForm busy={loading || submitting} submitting={submitting} draft={draft} error={error} onChange={setDraft} onSubmit={(event) => void submit(event)} onCancel={() => { closeForm('new-study'); setError(null); }} />
          : <Button ref={newStudyRef} size="sm" icon={<Plus size={12} />} onClick={() => { setAnnouncement(''); setCreating(true); }}>New study</Button>}
      </section>
    </div>
  );
}
