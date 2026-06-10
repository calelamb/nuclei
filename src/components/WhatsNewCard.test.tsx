// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { WhatsNewCard, shouldShowWhatsNew } from './WhatsNewCard';
import { WHATS_NEW } from '../data/whatsNew';

const SEEN_KEY = 'nuclei:whats_new_seen_version';
// Mocked "running" version — matches the release-notes entry so the card
// is eligible to show.
const CURRENT = WHATS_NEW.version;

beforeEach(() => {
  window.localStorage.clear();
  // jsdom does not implement matchMedia, which prefersReducedMotion() calls.
  // matches: true also exercises the reduced-motion dismiss path (the card
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

describe('<WhatsNewCard>', () => {
  it('renders the title, version chip and all highlights after an update', () => {
    window.localStorage.setItem(SEEN_KEY, '0.4.17');
    const { getByText } = render(<WhatsNewCard isDesktop currentVersion={CURRENT} />);

    expect(getByText(WHATS_NEW.title)).toBeTruthy();
    expect(getByText(`v${CURRENT}`)).toBeTruthy();
    for (const highlight of WHATS_NEW.highlights) {
      expect(getByText(highlight.text)).toBeTruthy();
    }
  });

  it('dismiss hides the card and records the seen version', () => {
    window.localStorage.setItem(SEEN_KEY, '0.4.17');
    const { getByLabelText, queryByText } = render(
      <WhatsNewCard isDesktop currentVersion={CURRENT} />,
    );

    fireEvent.click(getByLabelText("Dismiss what's new"));

    expect(queryByText(WHATS_NEW.title)).toBeNull();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe(CURRENT);
  });

  it('renders nothing on fresh install and primes the seen-version key', () => {
    const { container } = render(<WhatsNewCard isDesktop currentVersion={CURRENT} />);

    expect(container.innerHTML).toBe('');
    expect(window.localStorage.getItem(SEEN_KEY)).toBe(CURRENT);
  });

  it('does nothing on web (non-desktop)', () => {
    window.localStorage.setItem(SEEN_KEY, '0.4.17');
    const { container } = render(<WhatsNewCard isDesktop={false} currentVersion={CURRENT} />);

    expect(container.innerHTML).toBe('');
    expect(window.localStorage.getItem(SEEN_KEY)).toBe('0.4.17');
  });
});
