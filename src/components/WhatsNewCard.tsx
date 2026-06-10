import { useCallback, useEffect, useState } from 'react';
import { Atom, Bot, Rocket, Sigma, Sparkles, X, type LucideIcon } from 'lucide-react';
import { useThemeStore } from '../stores/themeStore';
import { WHATS_NEW, type WhatsNewEntry, type WhatsNewIcon } from '../data/whatsNew';
import { DURATION, EASING, prefersReducedMotion, staggerStyle } from '../lib/animations';

const SEEN_STORAGE_KEY = 'nuclei:whats_new_seen_version';

const HIGHLIGHT_ICONS: Record<WhatsNewIcon, LucideIcon> = {
  qsharp: Sigma,
  circuit: Atom,
  editor: Sparkles,
  dirac: Bot,
  hardware: Rocket,
};

/**
 * Decides whether the post-update card should appear.
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

interface WhatsNewCardProps {
  /** Injectable for tests. Defaults to the same Tauri check UpdateBanner uses. */
  isDesktop?: boolean;
  /** Injectable for tests. Defaults to the version Vite inlines at build time. */
  currentVersion?: string;
  /** Injectable for tests. Defaults to the shipped release notes. */
  entry?: WhatsNewEntry;
}

/**
 * Post-update "What's New" card. After the user updates Nuclei and
 * relaunches, this shows once describing what the version they just got
 * contains. Desktop only; on fresh installs it silently records the current
 * version so the *next* update gets its moment. Only dismissing writes the
 * seen-version key — until then the card reappears on each launch, so an
 * update never slips by unread.
 */
export function WhatsNewCard({
  isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window,
  currentVersion = __APP_VERSION__,
  entry = WHATS_NEW,
}: WhatsNewCardProps = {}) {
  const colors = useThemeStore((s) => s.colors);
  const shadow = useThemeStore((s) => s.shadow);
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [dismissHover, setDismissHover] = useState(false);
  const [dismissFocus, setDismissFocus] = useState(false);

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
      setVisible(true);
    }
  }, [isDesktop, currentVersion, entry.version]);

  const handleDismiss = useCallback(() => {
    window.localStorage.setItem(SEEN_STORAGE_KEY, currentVersion);
    if (prefersReducedMotion()) {
      setVisible(false);
      return;
    }
    setLeaving(true);
    window.setTimeout(() => setVisible(false), DURATION.normal);
  }, [currentVersion]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-label={`What's new in Nuclei ${currentVersion}`}
      style={{
        position: 'fixed',
        right: 20,
        // Sits above the UpdateBanner slot (fixed at bottom: 20) so both can
        // be on screen at once without overlapping.
        bottom: 132,
        zIndex: 2000,
        width: 340,
        background: colors.bgElevated,
        border: `1px solid ${colors.borderStrong}`,
        borderRadius: 10,
        boxShadow: shadow.lg,
        overflow: 'hidden',
        fontFamily: "'Geist Sans', sans-serif",
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'translateY(8px)' : 'translateY(0)',
        transition: `opacity ${DURATION.normal}ms ${EASING.exit}, transform ${DURATION.normal}ms ${EASING.exit}`,
        animation: prefersReducedMotion()
          ? 'none'
          : `nuclei-slide-up ${DURATION.slow}ms ${EASING.enter}`,
      }}
    >
      {/* Accent hairline anchors the card to the quantum-teal identity. */}
      <div
        aria-hidden
        style={{ height: 2, background: `linear-gradient(90deg, ${colors.accent}, transparent 70%)` }}
      />
      <div style={{ padding: '13px 16px 15px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '2px 8px',
                borderRadius: 999,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.04em',
                color: colors.accent,
                background: `${colors.accent}1f`,
                border: `1px solid ${colors.accent}55`,
              }}
            >
              {`v${currentVersion}`}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
                color: colors.textDim,
              }}
            >
              What's new
            </span>
          </div>
          <button
            onClick={handleDismiss}
            aria-label="Dismiss what's new"
            onMouseEnter={() => setDismissHover(true)}
            onMouseLeave={() => setDismissHover(false)}
            onFocus={() => setDismissFocus(true)}
            onBlur={() => setDismissFocus(false)}
            style={{
              background: dismissHover ? colors.border : 'none',
              border: 'none',
              color: dismissHover || dismissFocus ? colors.text : colors.textDim,
              cursor: 'pointer',
              padding: 3,
              display: 'flex',
              alignItems: 'center',
              borderRadius: 5,
              outline: 'none',
              boxShadow: dismissFocus ? `0 0 0 2px ${colors.accent}66` : 'none',
              transition: `background ${DURATION.fast}ms ${EASING.enter}, color ${DURATION.fast}ms ${EASING.enter}, box-shadow ${DURATION.fast}ms ${EASING.enter}`,
            }}
          >
            <X size={13} />
          </button>
        </div>
        <div
          style={{
            marginTop: 9,
            color: colors.text,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            lineHeight: 1.3,
          }}
        >
          {entry.title}
        </div>
        <ul
          style={{
            listStyle: 'none',
            margin: '11px 0 0',
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 9,
          }}
        >
          {entry.highlights.map((highlight, i) => {
            const Icon = HIGHLIGHT_ICONS[highlight.icon];
            return (
              <li
                key={highlight.text}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  ...staggerStyle(i),
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: `${colors.accent}14`,
                    color: colors.accent,
                    marginTop: 1,
                  }}
                >
                  <Icon size={12} strokeWidth={2} />
                </span>
                <span style={{ fontSize: 12, lineHeight: 1.5, color: colors.textMuted }}>
                  {highlight.text}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
