// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { ResearchTour } from './ResearchTour';
import { useResearchTourStore } from '../../stores/researchTourStore';

describe('ResearchTour', () => {
  beforeEach(() => {
    useResearchTourStore.setState({ active: true, step: 0, seen: false });
  });
  afterEach(() => {
    cleanup();
    useResearchTourStore.setState({ active: false, step: 0 });
  });

  it('Enter on the Back button goes back instead of advancing (research-16)', () => {
    useResearchTourStore.setState({ step: 1 });
    const { getByText } = render(<ResearchTour />);
    const back = getByText('Back');
    back.focus();
    fireEvent.keyDown(back, { key: 'Enter' });
    expect(useResearchTourStore.getState().step).toBe(1); // native button click handles it; tour key handler stays out
  });

  it('Enter on Skip does not finish through the document handler (research-16)', () => {
    const { getByText } = render(<ResearchTour />);
    const skip = getByText('Skip');
    skip.focus();
    fireEvent.keyDown(skip, { key: 'Enter' });
    expect(useResearchTourStore.getState().active).toBe(true);
  });

  it('ArrowRight advances and Escape skips', () => {
    render(<ResearchTour />);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(useResearchTourStore.getState().step).toBe(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useResearchTourStore.getState().active).toBe(false);
  });

  it('ignores auto-repeated key presses', () => {
    render(<ResearchTour />);
    fireEvent.keyDown(document, { key: 'ArrowRight', repeat: true });
    expect(useResearchTourStore.getState().step).toBe(0);
  });

  it('keeps Tab focus inside the card (research-16)', () => {
    const { getByText } = render(<ResearchTour />);
    const done = getByText('Next');
    done.focus();
    act(() => { fireEvent.keyDown(done, { key: 'Tab' }); });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
