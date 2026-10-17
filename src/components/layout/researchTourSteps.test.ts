import { describe, expect, it } from 'vitest';
import { researchTourSteps } from './researchTourSteps';

describe('researchTourSteps', () => {
  it('does not tell a user with an open project to open a folder (shell-12)', () => {
    const steps = researchTourSteps({ web: false, hasProject: true, mode: 'research' });
    expect(steps[0].body).not.toMatch(/open a folder/i);
  });

  it('sends desktop users to Experiments and web users to the QEC Workbench (shell-21)', () => {
    expect(researchTourSteps({ web: false, hasProject: false, mode: 'research' })[1].target).toBe('activity-experiments');
    const web = researchTourSteps({ web: true, hasProject: false, mode: 'research' });
    expect(web[1].target).toBe('activity-qec');
    expect(web[0].body).toMatch(/desktop app/i);
  });

  it('does not claim Research mode while in Learn mode (shell-12)', () => {
    const steps = researchTourSteps({ web: false, hasProject: false, mode: 'learn' });
    expect(steps[2].title).not.toMatch(/you're in research mode/i);
  });
});
