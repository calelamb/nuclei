// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { Onboarding } from './Onboarding';
import { researchCardDescription } from './researchCardCopy';

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

describe('Onboarding as a modal dialog', () => {
  it('exposes the chooser as an aria-modal dialog with an accessible name', () => {
    render(<Onboarding onComplete={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label') ?? dialog.getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('lands focus on the dialog, not a card, so no card opens with a focus ring (r7-learn-06)', () => {
    render(<Onboarding onComplete={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('the first arrow key or Tab moves focus onto the first card', () => {
    render(<Onboarding onComplete={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Learn quantum computing' }));
  });

  it('uses one content width on every step so the layout does not jump', () => {
    render(<Onboarding onComplete={vi.fn()} />);
    const width = () => (screen.getByRole('dialog').firstElementChild as HTMLElement).style.maxWidth;
    const chooser = width();
    fireEvent.click(screen.getByRole('button', { name: 'Learn quantum computing' }));
    expect(width()).toBe(chooser);
  });

  it('keeps Tab inside the dialog', () => {
    render(<Onboarding onComplete={vi.fn()} />);
    const research = screen.getByRole('button', { name: 'Research workspace' });
    research.focus();
    fireEvent.keyDown(research, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Learn quantum computing' }));
  });

  it('moves between cards with the arrow keys', () => {
    render(<Onboarding onComplete={vi.fn()} />);
    const learn = screen.getByRole('button', { name: 'Learn quantum computing' });
    learn.focus();
    fireEvent.keyDown(learn, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Research workspace' }));
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(learn);
  });

  it('can be completed with the keyboard alone', () => {
    const onComplete = vi.fn();
    render(<Onboarding onComplete={onComplete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Research workspace' }));
    expect(onComplete).toHaveBeenCalledWith('research');
  });

  it('Escape steps back from the Learn level picker to the chooser', () => {
    render(<Onboarding onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Learn quantum computing' }));
    expect(screen.getByRole('button', { name: "I'm experienced" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Research workspace' })).toBeTruthy();
  });

  it('Escape on the very first chooser does nothing (a choice is required)', () => {
    const onComplete = vi.fn();
    render(<Onboarding onComplete={onComplete} />);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('Learn level step Back button', () => {
  it('offers a visible Back that returns to the chooser with focus on the first card', () => {
    render(<Onboarding onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Learn quantum computing' }));
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog', { name: 'Welcome to Nuclei' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });
});

describe('returning-user screen', () => {
  it('Continue completes WITHOUT choosing a path, so the stored UI mode is kept', () => {
    const onComplete = vi.fn();
    render(<Onboarding onComplete={onComplete} isReturningUser lastOpenedFile="/a.py" daysSinceLastSession={9} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue where I left off' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0][0]).toBeUndefined();
  });

  it('Escape continues, because the returning screen is dismissible', () => {
    const onComplete = vi.fn();
    render(<Onboarding onComplete={onComplete} isReturningUser lastOpenedFile="/a.py" daysSinceLastSession={9} />);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(onComplete).toHaveBeenCalledWith(undefined);
  });

  it('says "Open IDE" when there is no file to return to', () => {
    render(<Onboarding onComplete={vi.fn()} isReturningUser daysSinceLastSession={9} />);
    expect(screen.getByRole('button', { name: 'Open IDE' })).toBeTruthy();
  });
});

describe('Learn level cards', () => {
  it('all three share one stripe colour and none promises a Dirac intro that does not exist', () => {
    render(<Onboarding onComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Learn quantum computing' }));
    const cards = ['brand new', 'some quantum', 'experienced'].map((n) => screen.getByRole('button', { name: new RegExp(n) }));
    const accents = cards.map((c) => c.style.getPropertyValue('--choice-accent'));
    expect(new Set(accents).size).toBe(1);
    expect(document.body.textContent).not.toMatch(/intro to Dirac/);
  });
});

describe('Research card copy', () => {
  it('only promises browser-capable work on the web build', () => {
    const web = researchCardDescription(true);
    expect(web).toMatch(/sinter CSV/);
    expect(web).toMatch(/desktop app/);
    expect(web).not.toMatch(/parameter sweeps/);
  });
  it('keeps the multi-file experiments promise on desktop', () => {
    expect(researchCardDescription(false)).toMatch(/parameter sweeps/);
  });
});
