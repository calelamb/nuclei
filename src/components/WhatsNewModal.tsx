import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { useThemeStore } from '../stores/themeStore';
import { WHATS_NEW, type WhatsNewEntry } from '../data/whatsNew';
import { DURATION, EASING, prefersReducedMotion } from '../lib/animations';
import { openExternal } from '../lib/openExternal';
import { WhatsNewHeader } from './WhatsNewHeader';
import { WhatsNewHighlightRow } from './WhatsNewHighlightRow';

const SEEN_STORAGE_KEY = 'nuclei:whats_new_seen_version';
const CHANGELOG_URL = 'https://github.com/calelamb/nuclei/releases';
const TITLE_ID = 'whats-new-title';
const FOCUSABLE_SELECTOR = 'button, a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Decides whether the post-update release moment should appear.
 *
 * Shown only when a previously-seen version exists AND differs from the
 * running version AND the release notes entry actually describes the running
 * version. A null stored version means fresh install — stay silent.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function shouldShowWhatsNew(
  storedVersion: string | null,
  currentVersion: string,
  entryVersion: string,
): boolean {
  return (
    storedVersion !== null &&
    storedVersion !== currentVersion &&
    entryVersion === currentVersion
  );
}

interface WhatsNewModalProps {
  /** Injectable for tests. Defaults to the same Tauri check UpdateBanner uses. */
  isDesktop?: boolean;
  /** Injectable for tests. Defaults to the version Vite inlines at build time. */
  currentVersion?: string;
  /** Injectable for tests. Defaults to the shipped release notes. */
  entry?: WhatsNewEntry;
}

/**
 * Post-update "What's New" release moment. After the user updates Nuclei and
 * relaunches, this shows once as a centered modal describing what the
 * version they just got contains. Desktop only; on fresh installs it
 * silently records the current version so the *next* update gets its
 * moment. Only dismissing writes the seen-version key — until then the
 * modal reappears on each launch, so an update never slips by unread.
 */
export function WhatsNewModal({
  isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
  currentVersion = __APP_VERSION__,
  entry = WHATS_NEW,
}: WhatsNewModalProps = {}) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const mode = useThemeStore((s) => s.mode);
  const [visible, setVisible] = useState(false);
  const [entered, setEntered] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [gotItHover, setGotItHover] = useState(false);
  const [gotItFocus, setGotItFocus] = useState(false);
  const [dismissHover, setDismissHover] = useState(false);
  const [dismissFocus, setDismissFocus] = useState(false);
  const [linkHover, setLinkHover] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isDesktop) return;
    const seen = window.localStorage.getItem(SEEN_STORAGE_KEY);
    if (seen === null) {
      // Fresh install: stay silent, just record the running version so the
      // next update shows its notes.
      window.localStorage.setItem(SEEN_STORAGE_KEY, currentVersion);
      return;
    }
    if (shouldShowWhatsNew(seen, currentVersion, entry.version)) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      setVisible(true);
    }
  }, [isDesktop, currentVersion, entry.version]);

  // Flip to the "entered" state a tick after mount so the entrance
  // transition has an initial state to animate from.
  useEffect(() => {
    if (!visible) {
      setEntered(false);
      return;
    }
    if (prefersReducedMotion()) {
      setEntered(true);
      return;
    }
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  // Focus the primary action once the dialog is on screen.
  useEffect(() => {
    if (!visible) return;
    const id = window.setTimeout(() => primaryButtonRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [visible]);

  const handleDismiss = useCallback(() => {
    window.localStorage.setItem(SEEN_STORAGE_KEY, currentVersion);
    const finish = () => {
      setVisible(false);
      setLeaving(false);
      previousFocusRef.current?.focus?.();
    };
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    setLeaving(true);
    window.setTimeout(finish, DURATION.normal);
  }, [currentVersion]);

  // Escape closes; Tab/Shift+Tab is trapped within the dialog.
  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleDismiss();
        return;
      }
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, handleDismiss]);

  if (!visible) return null;

  const reduced = prefersReducedMotion();
  const shown = entered && !leaving;
  const scrim = mode === 'dark' ? 'rgba(3, 8, 20, 0.68)' : 'rgba(15, 23, 42, 0.4)';

  return (
    <>
      <div
        aria-hidden="true"
        onClick={handleDismiss}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 3000,
          background: scrim,
          backdropFilter: 'blur(3px)',
          WebkitBackdropFilter: 'blur(3px)',
          opacity: shown ? 1 : 0,
          transition: reduced ? 'none' : `opacity ${DURATION.normal}ms ${EASING.enter}`,
        }}
      />
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 3001,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          pointerEvents: 'none',
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={TITLE_ID}
          aria-label={`What's new in Nuclei ${currentVersion}`}
          style={{
            pointerEvents: 'auto',
            position: 'relative',
            width: 'min(480px, calc(100vw - 40px))',
            maxWidth: 480,
            maxHeight: 'calc(100vh - 48px)',
            display: 'flex',
            flexDirection: 'column',
            background: colors.bgElevated,
            border: `1px solid ${colors.borderStrong}`,
            borderRadius: 16,
            boxShadow: `0 0 0 1px ${colors.accent}22, 0 24px 60px -20px ${colors.accent}40, ${shadow.lg}`,
            overflow: 'hidden',
            fontFamily: "'Geist Sans', sans-serif",
            opacity: shown ? 1 : 0,
            transform: reduced
              ? 'none'
              : shown
                ? 'scale(1) translateY(0)'
                : 'scale(0.96) translateY(8px)',
            transition: reduced
              ? 'none'
              : `opacity ${DURATION.slow}ms ${EASING.decelerate}, transform ${DURATION.slow}ms ${EASING.decelerate}`,
          }}
        >
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              background: `linear-gradient(90deg, ${colors.accent}, transparent 70%)`,
            }}
          />
          <button
            onClick={handleDismiss}
            aria-label="Dismiss what's new"
            onMouseEnter={() => setDismissHover(true)}
            onMouseLeave={() => setDismissHover(false)}
            onFocus={() => setDismissFocus(true)}
            onBlur={() => setDismissFocus(false)}
            style={{
              position: 'absolute',
              top: 14,
              right: 14,
              background: dismissHover ? colors.border : 'none',
              border: 'none',
              color: dismissHover || dismissFocus ? colors.text : colors.textDim,
              cursor: 'pointer',
              padding: 5,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 6,
              outline: 'none',
              boxShadow: dismissFocus ? `0 0 0 2px ${colors.accent}66` : 'none',
              transition: `background ${DURATION.fast}ms ${EASING.enter}, color ${DURATION.fast}ms ${EASING.enter}, box-shadow ${DURATION.fast}ms ${EASING.enter}`,
            }}
          >
            <X size={15} />
          </button>

          <div style={{ overflowY: 'auto', padding: '28px 28px 22px' }}>
            <WhatsNewHeader
              currentVersion={currentVersion}
              accent={colors.accent}
              textDim={colors.textDim}
              reduced={reduced}
            />

            <h2
              id={TITLE_ID}
              style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 650,
                letterSpacing: '-0.02em',
                lineHeight: 1.25,
                color: colors.text,
                textWrap: 'balance',
              }}
            >
              {entry.title}
            </h2>
            {entry.tagline && (
              <p
                style={{
                  margin: '6px 0 0',
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: colors.textMuted,
                }}
              >
                {entry.tagline}
              </p>
            )}

            <ul
              style={{
                listStyle: 'none',
                margin: '22px 0 0',
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}
            >
              {entry.highlights.map((highlight, i) => (
                <WhatsNewHighlightRow
                  key={highlight.title}
                  highlight={highlight}
                  index={i}
                  accent={colors.accent}
                  dirac={colors.dirac}
                  text={colors.text}
                  textMuted={colors.textMuted}
                />
              ))}
            </ul>
          </div>

          <div
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '14px 28px',
              borderTop: `1px solid ${colors.border}`,
            }}
          >
            <span style={{ fontSize: 11, color: colors.textDim }}>{`Nuclei v${currentVersion}`}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <a
                href={CHANGELOG_URL}
                onClick={(e) => {
                  e.preventDefault();
                  void openExternal(CHANGELOG_URL);
                }}
                onMouseEnter={() => setLinkHover(true)}
                onMouseLeave={() => setLinkHover(false)}
                onFocus={() => setLinkHover(true)}
                onBlur={() => setLinkHover(false)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12.5,
                  fontWeight: 500,
                  textDecoration: 'none',
                  color: linkHover ? colors.text : colors.textMuted,
                  transition: `color ${DURATION.fast}ms ${EASING.enter}`,
                }}
              >
                Full changelog
                <ArrowUpRight size={13} />
              </a>
              <button
                ref={primaryButtonRef}
                onClick={handleDismiss}
                onMouseEnter={() => setGotItHover(true)}
                onMouseLeave={() => setGotItHover(false)}
                onFocus={() => setGotItFocus(true)}
                onBlur={() => setGotItFocus(false)}
                style={{
                  background: gotItHover ? colors.accentLight : colors.accent,
                  color: '#0a0f1a',
                  border: 'none',
                  borderRadius: 8,
                  padding: '7px 16px',
                  cursor: 'pointer',
                  fontSize: 12.5,
                  fontWeight: 600,
                  fontFamily: "'Geist Sans', sans-serif",
                  boxShadow: gotItFocus
                    ? `0 0 0 2px ${colors.accent}66`
                    : gotItHover
                      ? shadow.md
                      : shadow.sm,
                  transform: gotItHover ? 'translateY(-1px)' : 'translateY(0)',
                  outline: 'none',
                  transition: `background ${DURATION.fast}ms ${EASING.enter}, box-shadow ${DURATION.fast}ms ${EASING.enter}, transform ${DURATION.fast}ms ${EASING.enter}`,
                }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
