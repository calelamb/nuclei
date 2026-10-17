import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useThemeStore } from '../../stores/themeStore';
import { useResearchTourStore, RESEARCH_TOUR_STEP_COUNT } from '../../stores/researchTourStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useProjectStore } from '../../stores/projectStore';
import { isWebBuild } from '../../platform/buildTarget';
import { researchTourSteps } from './researchTourSteps';

const CARD_WIDTH = 300;
const EDGE = 8;
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * PRD 11 Phase B — the first-run Research coach-mark tour.
 *
 * Three steps, pointing at the Explorer rail item, the Experiments rail item,
 * and the status-bar mode chip (each carries a `data-tour-target`). The target
 * stays lit (the dim comes from the spotlight's own shadow); clicking outside it
 * skips. Keyboard: →/Enter next (Enter only when no button has focus, so Back
 * and Skip keep their meaning), ← back, Esc skip, Tab is trapped in the card;
 * the step text is announced via `aria-live`.
 */

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function ResearchTour() {
  const colors = useThemeStore((s) => s.colors);
  const active = useResearchTourStore((s) => s.active);
  const step = useResearchTourStore((s) => s.step);
  const next = useResearchTourStore((s) => s.next);
  const prev = useResearchTourStore((s) => s.prev);
  const dismiss = useResearchTourStore((s) => s.dismiss);
  const [rect, setRect] = useState<Rect | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const mode = useWorkspaceStore((s) => s.mode);
  const hasProject = useProjectStore((s) => s.projectRoot !== null);
  const cardRef = useRef<HTMLDivElement>(null);
  const steps = researchTourSteps({ web: isWebBuild(), hasProject, mode });
  const current = steps[step] ?? steps[0];

  const measure = useCallback(() => {
    const el = document.querySelector<HTMLElement>(`[data-tour-target="${current.target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [current.target]);

  useEffect(() => {
    if (!active) return;
    // Measure after paint so the target's layout is settled (and to keep the
    // measurement out of the synchronous effect body).
    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, [active, measure]);

  useEffect(() => {
    if (!active) return;
    primaryRef.current?.focus();
    const trapTab = (e: KeyboardEvent) => {
      const items = Array.from(cardRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = cardRef.current?.contains(document.activeElement) ?? false;
      if (!inside || (e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) {
        e.preventDefault();
        (e.shiftKey && inside ? last : first).focus();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'Tab') { trapTab(e); return; }
      if (e.key === 'Escape') { e.preventDefault(); dismiss(); return; }
      const onButton = (e.target as HTMLElement | null)?.closest?.('button') != null;
      if (e.key === 'ArrowRight' || (e.key === 'Enter' && !onButton)) { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, step, next, prev, dismiss]);

  if (!active) return null;

  const isLast = step >= RESEARCH_TOUR_STEP_COUNT - 1;

  // Tooltip placement relative to the spotlighted target, kept inside the window.
  const tooltipStyle: React.CSSProperties = { position: 'fixed', width: CARD_WIDTH, maxWidth: '80vw' };
  if (rect) {
    if (current.placement === 'above') {
      tooltipStyle.left = Math.min(Math.max(EDGE, rect.left), window.innerWidth - CARD_WIDTH - EDGE);
      tooltipStyle.bottom = window.innerHeight - rect.top + 14;
    } else {
      tooltipStyle.left = Math.min(rect.left + rect.width + 14, window.innerWidth - CARD_WIDTH - EDGE);
      tooltipStyle.top = Math.max(EDGE, Math.min(rect.top, window.innerHeight - 260));
    }
  } else {
    // Target not found (e.g. rail item hidden) — centre the card.
    tooltipStyle.left = '50%';
    tooltipStyle.top = '50%';
    tooltipStyle.transform = 'translate(-50%, -50%)';
  }

  // Click-catcher that leaves a hole over the target so it stays interactive/lit.
  const hole = rect
    ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.left - 4}px ${rect.top - 4}px, ${rect.left - 4}px ${rect.top + rect.height + 4}px, ${rect.left + rect.width + 4}px ${rect.top + rect.height + 4}px, ${rect.left + rect.width + 4}px ${rect.top - 4}px, ${rect.left - 4}px ${rect.top - 4}px)`
    : undefined;

  const overlay = (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200 }}>
      {/* Click-catcher outside the target (click to skip). The dim is the spotlight's
          shadow below, so the target itself is never darkened. */}
      <div
        onClick={dismiss}
        style={{ position: 'absolute', inset: 0, clipPath: hole, background: rect ? 'transparent' : 'rgba(0,0,0,0.5)' }}
      />
      {/* Spotlight ring around the target. */}
      {rect && (
        <div
          style={{
            position: 'fixed',
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            borderRadius: 8,
            border: `2px solid ${colors.dirac}`,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        />
      )}
      {/* Tooltip card. */}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="research-tour-title"
        style={{
          ...tooltipStyle,
          background: colors.bgPanel,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          padding: 16,
          boxShadow: '0 12px 48px rgba(0,0,0,0.4)',
          fontFamily: "'Geist Sans', sans-serif",
        }}
      >
        {rect && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', width: 10, height: 10, background: colors.bgPanel,
              transform: 'rotate(45deg)',
              ...(current.placement === 'above'
                ? { bottom: -6, left: 18, borderRight: `1px solid ${colors.border}`, borderBottom: `1px solid ${colors.border}` }
                : { left: -6, top: Math.max(12, rect.top + rect.height / 2 - (typeof tooltipStyle.top === 'number' ? tooltipStyle.top : 0) - 5), borderLeft: `1px solid ${colors.border}`, borderBottom: `1px solid ${colors.border}` }),
            }}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span
            style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: colors.dirac, textTransform: 'uppercase' }}
          >
            Research tour
          </span>
          <span style={{ fontSize: 10, color: colors.textDim }}>
            {step + 1} / {RESEARCH_TOUR_STEP_COUNT}
          </span>
        </div>
        <div
          id="research-tour-title"
          style={{ fontSize: 14, fontWeight: 600, color: colors.text, marginBottom: 6 }}
        >
          {current.title}
        </div>
        <div aria-live="polite" style={{ fontSize: 12.5, lineHeight: 1.5, color: colors.textMuted, marginBottom: 16 }}>
          {current.body}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={dismiss}
            style={{
              padding: '5px 10px', background: 'transparent', color: colors.textDim,
              border: 'none', borderRadius: 6, fontSize: 11, cursor: 'pointer',
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            Skip
          </button>
          <div style={{ flex: 1 }} />
          {step > 0 && (
            <button
              onClick={prev}
              style={{
                padding: '5px 12px', background: 'transparent', color: colors.textDim,
                border: `1px solid ${colors.border}`, borderRadius: 6, fontSize: 11, cursor: 'pointer',
                fontFamily: "'Geist Sans', sans-serif",
              }}
            >
              Back
            </button>
          )}
          <button
            ref={primaryRef}
            onClick={next}
            style={{
              padding: '5px 14px', background: colors.dirac, color: '#fff',
              border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              fontFamily: "'Geist Sans', sans-serif",
            }}
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
