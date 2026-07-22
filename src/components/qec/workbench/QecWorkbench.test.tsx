// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQecStudyStore } from '../../../services/qecStudyStore';
import { useQecStudyUiStore } from '../../../stores/qecStudyUiStore';
import { useQecWorkbenchStore } from '../../../stores/qecWorkbenchStore';
import {
  EMPTY_RESEARCH_SELECTION,
  useResearchSelectionStore,
} from '../../../stores/researchSelectionStore';
import { QecWorkbench } from './QecWorkbench';

const shellStyles = readFileSync(
  resolve(process.cwd(), 'src/components/qec/workbench/qecWorkbench.css'),
  'utf8',
);

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const STUDY = {
  schema: 1 as const,
  id: 'surface-memory',
  name: 'Surface Memory',
  question: 'Which decoder reduces logical error?',
  preset: 'build' as const,
  tags: ['memory'],
  sources: [
    { id: 'circuit-d7', kind: 'stim' as const, path: 'circuits/surface-d7.stim' },
    { id: 'campaign-a', kind: 'experiment' as const, path: 'experiments/memory.experiment.yaml' },
  ],
};

const SECOND_STUDY = {
  ...STUDY,
  id: 'decoder-study',
  name: 'Decoder Study',
  question: 'Which decoder has the best tail latency?',
  preset: 'analyze' as const,
  sources: [],
};

const STUDY_UI_ACTIONS = {
  clearActiveStudy: useQecStudyUiStore.getState().clearActiveStudy,
  setActiveStudy: useQecStudyUiStore.getState().setActiveStudy,
};

function setStudies(studies = [STUDY, SECOND_STUDY]): void {
  useQecStudyStore.setState({
    studies: studies.map((study) => ({
      fileName: `${study.id}.qec-study.yaml`,
      path: `studies/${study.id}.qec-study.yaml`,
      study,
    })),
    validationErrors: [],
    loading: false,
  });
}

afterEach(() => cleanup());

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
  setStudies([STUDY]);
  useQecStudyUiStore.setState({ activeStudyId: STUDY.id, ...STUDY_UI_ACTIONS });
  useQecWorkbenchStore.setState({
    preset: 'build',
    pinnedPanelIds: [],
    sourceWidth: 280,
    inspectorWidth: 360,
    trayHeight: 260,
  });
  useResearchSelectionStore.setState({
    past: [],
    present: EMPTY_RESEARCH_SELECTION,
    future: [],
  });
});

describe('<QecWorkbench />', () => {
  it('renders four named regions and moves between presets', () => {
    render(<QecWorkbench />);

    const sources = screen.getByRole('navigation', { name: 'QEC sources and data' });
    const canvas = screen.getByRole('main', { name: 'QEC investigation canvas' });
    const inspector = screen.getByRole('complementary', { name: 'Research inspector' });
    const tray = screen.getByRole('region', { name: 'QEC jobs and streams' });
    const isBefore = (first: Element, second: Element): boolean =>
      Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(isBefore(sources, canvas)).toBe(true);
    expect(isBefore(canvas, inspector)).toBe(true);
    expect(isBefore(inspector, tray)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(useQecWorkbenchStore.getState().preset).toBe('analyze');
    expect(screen.getByRole('button', { name: 'Analyze' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('uses the active Study and panel registry to populate shell instruments', () => {
    render(<QecWorkbench />);

    expect(screen.getByRole('combobox', { name: 'Active QEC Study' })).toHaveProperty(
      'value',
      STUDY.id,
    );
    const canvas = screen.getByRole('main', { name: 'QEC investigation canvas' });
    expect(within(canvas).getByText('Timeline')).toBeTruthy();
    expect(within(canvas).getByText('Code Lattice')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(within(canvas).getByText('Campaign Center')).toBeTruthy();
  });

  it('uses a native labeled Study control and preserves keyboard selection semantics', () => {
    setStudies();
    render(<QecWorkbench />);

    const picker = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Active QEC Study' });
    picker.focus();
    fireEvent.keyDown(picker, { key: 'ArrowDown' });
    fireEvent.change(picker, { target: { value: SECOND_STUDY.id } });

    expect(document.activeElement).toBe(picker);
    expect(useQecStudyUiStore.getState().activeStudyId).toBe(SECOND_STUDY.id);
    expect(picker.value).toBe(SECOND_STUDY.id);
  });

  it('clears Study selection through the explicit UI-store action', () => {
    const clearActiveStudy = vi.fn(STUDY_UI_ACTIONS.clearActiveStudy);
    useQecStudyUiStore.setState({ clearActiveStudy });
    render(<QecWorkbench />);

    fireEvent.change(
      screen.getByRole<HTMLSelectElement>('combobox', { name: 'Active QEC Study' }),
      { target: { value: '' } },
    );

    expect(clearActiveStudy).toHaveBeenCalledOnce();
    expect(useQecStudyUiStore.getState().activeStudyId).toBeNull();
  });

  it('asks for a Study choice when Studies exist but the active id is stale', () => {
    setStudies();
    useQecStudyUiStore.setState({ activeStudyId: 'missing-study' });
    render(<QecWorkbench />);

    expect(screen.getByText('Choose a Study')).toBeTruthy();
    expect(screen.getByText(/Use the Study control/)).toBeTruthy();
    expect(screen.queryByText('No Studies found')).toBeNull();
  });

  it('opens and closes the responsive inspector with Escape and returns focus', () => {
    render(<QecWorkbench />);

    const toggle = screen.getByRole('button', { name: 'Hide research inspector' });
    const inspector = screen.getByRole('complementary', { name: 'Research inspector' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(inspector.id);

    fireEvent.click(within(inspector).getByRole('button', { name: 'Close research inspector' }));
    expect(screen.queryByRole('complementary', { name: 'Research inspector' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show research inspector' })).toBe(document.activeElement);

    fireEvent.click(screen.getByRole('button', { name: 'Show research inspector' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Research inspector' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show research inspector' })).toBe(document.activeElement);
  });

  it('moves backward and forward through the shared Research Trail', () => {
    useResearchSelectionStore.getState().selectPrimary(
      { kind: 'campaign-point', id: 'p=.004' },
      'user',
    );
    useResearchSelectionStore.getState().refineScope(
      { kind: 'detector', id: 'D42' },
      'user',
    );
    render(<QecWorkbench />);

    const trail = screen.getByRole('navigation', { name: 'Research trail' });
    expect(within(trail).getByText('p=.004')).toBeTruthy();
    expect(within(trail).getByText('D42')).toBeTruthy();

    fireEvent.click(within(trail).getByRole('button', { name: 'Back in research trail' }));
    expect(within(trail).queryByText('D42')).toBeNull();
    expect(within(trail).getByRole<HTMLButtonElement>('button', { name: 'Forward in research trail' }).disabled).toBe(false);
  });

  it('keeps tray lifecycle content available while allowing it to collapse', () => {
    render(<QecWorkbench />);

    const tray = screen.getByRole('region', { name: 'QEC jobs and streams' });
    const toggle = within(tray).getByRole('button', { name: 'Collapse jobs and streams' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(tray).getByText('No active jobs')).toBeTruthy();

    fireEvent.click(toggle);
    expect(
      within(tray).getByRole('button', { name: 'Expand jobs and streams' }).getAttribute('aria-expanded'),
    ).toBe('false');
    expect(within(tray).queryByText('No active jobs')).toBeNull();
  });

  it('renders a distinct Study loading state', () => {
    useQecStudyUiStore.setState({ activeStudyId: null });
    useQecStudyStore.setState({ studies: [], validationErrors: [], loading: true });
    render(<QecWorkbench />);
    expect(screen.getByRole('status', { name: 'Loading QEC Studies' })).toBeTruthy();
    expect(screen.getByText('Validating Study manifests and referenced sources.')).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: 'QEC sources and data' })).queryByText('Validated')).toBeNull();
  });

  it('renders malformed Study file names and actionable validation details', () => {
    useQecStudyUiStore.setState({ activeStudyId: null });
    useQecStudyStore.setState({
      studies: [],
      loading: false,
      validationErrors: [{
        fileName: 'broken.qec-study.yaml',
        errors: ['question: Required', 'sources.0.path: path must stay inside the project'],
      }],
    });
    render(<QecWorkbench />);
    expect(screen.getByRole('alert', { name: 'Study validation issues' })).toBeTruthy();
    expect(screen.getByText('broken.qec-study.yaml')).toBeTruthy();
    expect(screen.getByText('question: Required')).toBeTruthy();
    expect(screen.getByText(/path must stay inside the project/)).toBeTruthy();
    expect(screen.getByText(/Fix these fields and save/)).toBeTruthy();
    expect(screen.getByText('2 validation issues')).toBeTruthy();
  });

  it('renders a safe empty state when no Studies exist', () => {
    useQecStudyUiStore.setState({ activeStudyId: null });
    useQecStudyStore.setState({ studies: [], validationErrors: [], loading: false });
    render(<QecWorkbench />);
    expect(screen.getByText('No Studies found')).toBeTruthy();
    expect(screen.getByText(/Create a Study manifest/)).toBeTruthy();
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Active QEC Study' }).disabled).toBe(true);
  });

  it('defines exact light, responsive, overflow, focus, and reduced-motion contracts', () => {
    expect(shellStyles).toContain('--qec-canvas: #ffffff');
    expect(shellStyles).toContain('--qec-recessed: #f1f5f9');
    expect(shellStyles).toContain('--qec-analytical: #2563eb');
    expect(shellStyles).toMatch(/\.qec-workbench\s*{[\s\S]*?overflow: hidden;/);
    expect(shellStyles).toMatch(/@media \(max-width: 1179px\)[\s\S]*?\.qec-inspector\s*{[\s\S]*?position: absolute;/);
    expect(shellStyles).toMatch(/@media \(max-width: 899px\)[\s\S]*?\.qec-tray--collapsed\s*{[\s\S]*?height: 45px;/);
    expect(shellStyles).toContain('@media (max-width: 699px)');
    expect(shellStyles).toMatch(/\.qec-inspector\[hidden\]\s*{[\s\S]*?display: none;/);
    expect(shellStyles).toContain('outline: 2px solid var(--qec-analytical)');
    expect(shellStyles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition-duration: 0\.01ms !important;/);
  });
});
