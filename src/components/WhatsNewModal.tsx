import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { useThemeStore } from '../stores/themeStore';
import { WHATS_NEW, highlightsFor, type WhatsNewEntry } from '../data/whatsNew';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { DURATION, EASING, prefersReducedMotion } from '../lib/animations';
import { openExternal } from '../lib/openExternal';
import { useWhatsNewStore } from '../stores/whatsNewStore';
import { Button, IconButton } from './ui';
import { WhatsNewHeader } from './WhatsNewHeader';
import { WhatsNewHighlightRow } from './WhatsNewHighlightRow';

import { TYPOGRAPHY } from '../styles/tokens';
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
  if (storedVersion === null) return false;
  // The notes are new to this user (newer than what they last saw) and already
  // shipped (not newer than what is running). A patch release (0.14.1) that
  // ships no notes of its own therefore still surfaces the 0.14.0 notes to
  // anyone upgrading from 0.13.x, instead of silently skipping them.
  return compareVersions(storedVersion, entryVersion) < 0 && compareVersions(entryVersion, currentVersion) <= 0;
}

/** Numeric dotted-version compare (ignores any pre-release suffix). */
// eslint-disable-next-line react-refresh/only-export-components
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * What the version pill says. Notes written for a release the running build has not
 * reached yet are labelled as upcoming, never as the version the person is on.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function versionBadge(entryVersion: string, currentVersion: string): string {
  if (compareVersions(entryVersion, currentVersion) <= 0) return `v${entryVersion}`;
  const [major, minor] = entryVersion.split('.');
  return `Coming in ${major}.${minor ?? '0'}`;
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
  const workspaceMode = useWorkspaceStore((s) => s.mode);
  const [visible, setVisible] = useState(false);
  const [entered, setEntered] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [linkHover, setLinkHover] = useState(false);
  const requested = useWhatsNewStore((st) => st.requested);
  const clearRequest = useWhatsNewStore((st) => st.clearRequest);

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

  // Re-open on demand (command palette / Settings > Help), on any platform.
  useEffect(() => {
    if (!requested) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setVisible(true);
    clearRequest();
  }, [requested, clearRequest]);

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
  const scrim = colors.scrim;
  const highlights = highlightsFor(entry, { platform: isDesktop ? 'desktop' : 'web', mode: workspaceMode });

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
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
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
          aria-label={`What's new in Nuclei ${entry.version}`}
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
            fontFamily: TYPOGRAPHY.fontSans,
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
          <IconButton
            aria-label="Dismiss what's new"
            size="sm"
            onClick={handleDismiss}
            style={{ position: 'absolute', top: 14, right: 14 }}
          >
            <X size={16} />
          </IconButton>

          <div style={{ overflowY: 'auto', padding: '28px 28px 22px' }}>
            <WhatsNewHeader
              versionLabel={versionBadge(entry.version, currentVersion)}
              accent={colors.accent}
              textDim={colors.textDim}
              reduced={reduced}
            />

            <h2
              id={TITLE_ID}
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 600,
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
                  fontSize: 13,
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
              {highlights.map((highlight, i) => (
                <WhatsNewHighlightRow
                  key={highlight.title}
                  highlight={highlight}
                  index={i}
                  accent={colors.accentText}
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
                  fontSize: 13,
                  fontWeight: 500,
                  textDecoration: 'none',
                  color: linkHover ? colors.text : colors.textMuted,
                  transition: `color ${DURATION.fast}ms ${EASING.enter}`,
                }}
              >
                Full changelog
                <ArrowUpRight size={14} />
              </a>
              <Button ref={primaryButtonRef} variant="primary" onClick={handleDismiss}>
                Got it
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
