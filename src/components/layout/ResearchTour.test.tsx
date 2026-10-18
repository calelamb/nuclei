// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/react';
import { ResearchTour } from './ResearchTour';
import { useResearchTourStore } from '../../stores/researchTourStore';
import { useNavigationStore } from '../../stores/navigationStore';

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

  it('puts focus on Next, and pulls it back from a text field that steals it', async () => {
    const editor = document.createElement('textarea');
    document.body.appendChild(editor);
    const { getByText } = render(<ResearchTour />);
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    expect(document.activeElement).toBe(getByText('Next'));
    act(() => { editor.focus(); });
    expect(document.activeElement).toBe(getByText('Next'));
    editor.remove();
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

  it('returns focus to the control that had it when Escape skips the tour (no drop to <body>)', () => {
    useResearchTourStore.setState({ active: false, step: 0 });
    const opener = document.createElement('button');
    opener.textContent = 'opener';
    document.body.appendChild(opener);
    opener.focus();
    render(<ResearchTour />);
    act(() => { useResearchTourStore.setState({ active: true }); });
    expect(document.activeElement).not.toBe(opener);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('falls back to the editor when the opener is gone', () => {
    useResearchTourStore.setState({ active: false, step: 0 });
    const editor = document.createElement('textarea');
    editor.setAttribute('aria-label', 'Editor content');
    document.body.appendChild(editor);
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    render(<ResearchTour />);
    act(() => { useResearchTourStore.setState({ active: true }); });
    opener.remove();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(editor);
    editor.remove();
  });

  it('waits for an editor that remounts after the tour (QEC takeover) and focuses it on Done', async () => {
    useResearchTourStore.setState({ active: false, step: 0 });
    const opener = document.createElement('textarea');
    document.body.appendChild(opener);
    opener.focus();
    render(<ResearchTour />);
    act(() => { useResearchTourStore.setState({ active: true }); });
    opener.remove(); // Monaco unmounted by the takeover
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(document.body);
    const editor = document.createElement('textarea');
    editor.setAttribute('aria-label', 'Editor content');
    setTimeout(() => document.body.appendChild(editor), 60);
    await waitFor(() => expect(document.activeElement).toBe(editor));
    editor.remove();
  });

  it('falls back to the mode chip when no editor ever mounts', async () => {
    useResearchTourStore.setState({ active: false, step: 0 });
    const chip = document.createElement('button');
    chip.setAttribute('aria-label', 'Switch workspace mode');
    document.body.appendChild(chip);
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    render(<ResearchTour />);
    act(() => { useResearchTourStore.setState({ active: true }); });
    opener.remove();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(chip), { timeout: 1500 });
    chip.remove();
  });

  it('declares itself modal for assistive tech, since focus is held inside the card', () => {
    render(<ResearchTour />);
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
  });

  describe('shows the pane each step describes', () => {
    afterEach(() => useNavigationStore.setState({ activeView: 'files' }));

    it('opens the Explorer for step 1 even when Settings was showing, and puts Settings back on Done', () => {
      useNavigationStore.setState({ activeView: 'settings' });
      useResearchTourStore.setState({ active: false, step: 0 });
      render(<ResearchTour />);
      act(() => { useResearchTourStore.setState({ active: true }); });
      expect(useNavigationStore.getState().activeView).toBe('files');
      act(() => { useResearchTourStore.getState().dismiss(); });
      expect(useNavigationStore.getState().activeView).toBe('settings');
    });

    it('does not undo a navigation the student made themselves during the tour', () => {
      useNavigationStore.setState({ activeView: 'settings' });
      useResearchTourStore.setState({ active: false, step: 0 });
      render(<ResearchTour />);
      act(() => { useResearchTourStore.setState({ active: true }); });
      act(() => { useNavigationStore.getState().setActiveView('search'); });
      act(() => { useResearchTourStore.getState().dismiss(); });
      expect(useNavigationStore.getState().activeView).toBe('search');
    });
  });
});
