// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { WhatsNewModal, shouldShowWhatsNew } from './WhatsNewModal';
import { WHATS_NEW } from '../data/whatsNew';

const SEEN_KEY = 'nuclei:whats_new_seen_version';
// Mocked "running" version — matches the release-notes entry so the modal
// is eligible to show.
const CURRENT = WHATS_NEW.version;

beforeEach(() => {
  window.localStorage.clear();
  // jsdom does not implement matchMedia, which prefersReducedMotion() calls.
  // matches: true also exercises the reduced-motion dismiss path (the modal
  // hides immediately instead of waiting out the exit animation).
  const fakeMatchMedia = (query: string): MediaQueryList =>
    ({ matches: true, media: query }) as unknown as MediaQueryList;
  vi.stubGlobal('matchMedia', fakeMatchMedia);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('shouldShowWhatsNew', () => {
  it('returns false on fresh install (no stored version)', () => {
    expect(shouldShowWhatsNew(null, '0.5.0', '0.5.0')).toBe(false);
  });

  it('returns false when the stored version equals the current version', () => {
    expect(shouldShowWhatsNew('0.5.0', '0.5.0', '0.5.0')).toBe(false);
  });

  it('returns true when the stored version differs and the entry matches', () => {
    expect(shouldShowWhatsNew('0.4.17', '0.5.0', '0.5.0')).toBe(true);
  });

  it('returns false when the entry does not describe the current version', () => {
    expect(shouldShowWhatsNew('0.4.17', '0.5.0', '0.4.18')).toBe(false);
  });
});

describe('<WhatsNewModal>', () => {
  it('renders nothing on fresh install and primes the seen-version key', () => {
    const { container } = render(<WhatsNewModal isDesktop currentVersion={CURRENT} />);

    expect(container.innerHTML).toBe('');
    expect(window.localStorage.getItem(SEEN_KEY)).toBe(CURRENT);
  });

  it('does nothing on web (non-desktop)', () => {
    window.localStorage.setItem(SEEN_KEY, '0.4.17');
    const { container } = render(<WhatsNewModal isDesktop={false} currentVersion={CURRENT} />);

    expect(container.innerHTML).toBe('');
    expect(window.localStorage.getItem(SEEN_KEY)).toBe('0.4.17');
  });

  it('renders the dialog with title, version pill, and all highlight labels after an update', () => {
    window.localStorage.setItem(SEEN_KEY, '0.4.17');
    const { getByText, getByRole } = render(
      <WhatsNewModal isDesktop currentVersion={CURRENT} />,
    );

    const dialog = getByRole('dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('whats-new-title');
    expect(dialog.getAttribute('aria-label')).toContain(CURRENT);

    expect(getByText(WHATS_NEW.title)).toBeTruthy();
    expect(getByText(`v${CURRENT}`)).toBeTruthy();
    for (const highlight of WHATS_NEW.highlights) {
      expect(getByText(highlight.title)).toBeTruthy();
      expect(getByText(highlight.text)).toBeTruthy();
    }
  });

  it('focuses the primary "Got it" button when the dialog opens', async () => {
    window.localStorage.setItem(SEEN_KEY, '0.4.17');
    const { getByRole } = render(<WhatsNewModal isDesktop currentVersion={CURRENT} />);

    const gotIt = getByRole('button', { name: 'Got it' });
    await waitFor(() => expect(document.activeElement).toBe(gotIt));
  });

  it('"Got it" dismiss writes localStorage and unmounts the dialog', () => {
    window.localStorage.setItem(SEEN_KEY, '0.4.17');
    const { getByRole, queryByRole } = render(
      <WhatsNewModal isDesktop currentVersion={CURRENT} />,
    );

    fireEvent.click(getByRole('button', { name: 'Got it' }));

    expect(queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe(CURRENT);
  });

  it('the X dismiss button writes localStorage and unmounts the dialog', () => {
    window.localStorage.setItem(SEEN_KEY, '0.4.17');
    const { getByLabelText, queryByRole } = render(
      <WhatsNewModal isDesktop currentVersion={CURRENT} />,
    );

    fireEvent.click(getByLabelText("Dismiss what's new"));

    expect(queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe(CURRENT);
  });

  it('clicking the backdrop dismisses the dialog', () => {
    window.localStorage.setItem(SEEN_KEY, '0.4.17');
    const { container, queryByRole } = render(
      <WhatsNewModal isDesktop currentVersion={CURRENT} />,
    );

    const backdrop = container.querySelector('[aria-hidden="true"]');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop as Element);

    expect(queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe(CURRENT);
  });

  it('Escape closes the dialog and records the seen version', () => {
    window.localStorage.setItem(SEEN_KEY, '0.4.17');
    const { queryByRole } = render(<WhatsNewModal isDesktop currentVersion={CURRENT} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe(CURRENT);
  });
});
