// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CapstoneProjectView } from './CapstoneProject';
import { useCapstoneStore } from '../../stores/capstoneStore';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore } from '../../stores/projectStore';
import { useLearnStore } from '../../stores/learnStore';
import { CAPSTONE_PROJECTS } from '../../data/capstoneProjects';

const project = CAPSTONE_PROJECTS[0];
const WORK = '# MY IMPORTANT WORK\n';

function open() {
  useCapstoneStore.setState({ activeProject: project, activeMilestoneIndex: 0, completedMilestones: {} });
  return render(<CapstoneProjectView />);
}

beforeEach(() => {
  useProjectStore.setState({ tabs: [], activeTabPath: null });
  useEditorStore.setState({ code: WORK, isDirty: true, filePath: null, framework: 'qiskit' });
});
afterEach(() => { cleanup(); useCapstoneStore.setState({ activeProject: null, activeMilestoneIndex: 0, completedMilestones: {} }); });

describe('CapstoneProjectView', () => {
  it("never shows Dirac's system prompt to the learner and shows the full description", () => {
    open();
    expect(document.body.textContent).not.toContain('You are guiding');
    expect(screen.queryByText(/Dirac guidance/)).toBeNull();
    expect(screen.getByText(project.description)).toBeTruthy();
  });

  it('moves focus to the project title on Start', () => {
    open();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: project.title }));
  });

  it('focuses the next step after Mark complete', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }));
    const next = screen.getByRole('button', { name: new RegExp(project.milestones[1].title) });
    expect(document.activeElement).toBe(next);
    expect(next.getAttribute('aria-current')).toBe('step');
  });

  it('uses the lesson hint idiom, counting revealed hints from zero', () => {
    open();
    const total = project.milestones[0].hints.length;
    fireEvent.click(screen.getByRole('button', { name: `Show hint (0/${total})` }));
    expect(screen.getByRole('button', { name: `Show hint (1/${total})` })).toBeTruthy();
  });

  it('step titles are disclosures that can be collapsed', () => {
    open();
    const title = screen.getByRole('button', { name: new RegExp(project.milestones[0].title) });
    expect(title.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(title);
    expect(title.getAttribute('aria-expanded')).toBe('false');
  });

  it('asks before Load starter code replaces unsaved work and keeps it on cancel', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Load starter code' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(useEditorStore.getState().code).toBe(WORK);
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(useEditorStore.getState().code).toBe(WORK);
    expect(screen.queryByText(/Starter loaded/)).toBeNull();
  });

  it('confirming loads the starter, says so, and offers Open editor', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Load starter code' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Replace' }));
    expect(await screen.findByText('Starter loaded in the editor.')).toBeTruthy();
    expect(useEditorStore.getState().code).toBe(project.milestones[0].starterCode);
    useLearnStore.setState({ isLearnMode: true });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open editor' })); });
    expect(useLearnStore.getState().isLearnMode).toBe(false);
  });

  it('in project mode opens a new tab with no confirm', async () => {
    useProjectStore.getState().openTab({ path: '/p/a.py', content: 'mine' });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Load starter code' }));
    expect(await screen.findByText('Starter loaded in a new tab.')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(useProjectStore.getState().tabs.find((t) => t.path === '/p/a.py')?.content).toBe('mine');
  });
});
