// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

afterEach(() => cleanup());

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
  useQecStudyStore.setState({
    studies: [{ fileName: 'surface-memory.qec-study.yaml', path: 'studies/surface-memory.qec-study.yaml', study: STUDY }],
    validationErrors: [],
    loading: false,
  });
  useQecStudyUiStore.setState({ activeStudyId: STUDY.id });
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

    expect(screen.getByRole('navigation', { name: 'QEC sources and data' })).toBeTruthy();
    expect(screen.getByRole('main', { name: 'QEC investigation canvas' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Research inspector' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'QEC jobs and streams' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(useQecWorkbenchStore.getState().preset).toBe('analyze');
    expect(screen.getByRole('button', { name: 'Analyze' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('uses the active Study and panel registry to populate shell instruments', () => {
    render(<QecWorkbench />);

    expect(screen.getByRole('button', { name: /Study: Surface Memory/ })).toBeTruthy();
    const canvas = screen.getByRole('main', { name: 'QEC investigation canvas' });
    expect(within(canvas).getByText('Timeline')).toBeTruthy();
    expect(within(canvas).getByText('Code Lattice')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(within(canvas).getByText('Campaign Center')).toBeTruthy();
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

  it('defines the approved responsive and reduced-motion contracts', () => {
    expect(shellStyles).toContain('@media (max-width: 1179px)');
    expect(shellStyles).toContain('@media (max-width: 899px)');
    expect(shellStyles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(shellStyles).toContain(':focus-visible');
  });
});
