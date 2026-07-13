import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useThemeStore } from '../../stores/themeStore';
import { useResearchTourStore, RESEARCH_TOUR_STEP_COUNT } from '../../stores/researchTourStore';

/**
 * PRD 11 Phase B — the first-run Research coach-mark tour.
 *
 * Three steps, pointing at the Explorer rail item, the Experiments rail item,
 * and the status-bar mode chip (each carries a `data-tour-target`). Non-modal:
 * the dim backdrop dismisses on click but does not trap the app. Fully
 * keyboard-driven: →/Enter next, ← back, Esc skip; focus lands on the primary
 * button each step and the step text is announced via `aria-live`.
 */

interface TourStep {
  target: string;
  title: string;
  body: string;
  placement: 'right' | 'above';
}

const STEPS: TourStep[] = [
  {
    target: 'activity-files',
    title: 'Explorer',
    body: 'Your project files live here. Open a folder to bring your code into the workspace.',
    placement: 'right',
  },
  {
    target: 'activity-experiments',
    title: 'Experiments',
    body: 'Declare parameter sweeps and QEC campaigns, run them, and compare results — all as files in your project.',
    placement: 'right',
  },
  {
    target: 'mode-chip',
    title: "You're in Research mode",
    body: 'This chip always shows your mode and switches it. Switching never stops a running job — it only changes what you see.',
    placement: 'above',
  },
];

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

  const current = STEPS[step] ?? STEPS[0];

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, step, next, prev, dismiss]);

  if (!active) return null;

  const isLast = step >= RESEARCH_TOUR_STEP_COUNT - 1;

  // Tooltip placement relative to the spotlighted target.
  const tooltipStyle: React.CSSProperties = { position: 'fixed', width: 300, maxWidth: '80vw' };
  if (rect) {
    if (current.placement === 'above') {
      tooltipStyle.left = Math.max(8, rect.left);
      tooltipStyle.bottom = window.innerHeight - rect.top + 10;
    } else {
      tooltipStyle.left = rect.left + rect.width + 12;
      tooltipStyle.top = rect.top;
    }
  } else {
    // Target not found (e.g. rail item hidden) — centre the card.
    tooltipStyle.left = '50%';
    tooltipStyle.top = '50%';
    tooltipStyle.transform = 'translate(-50%, -50%)';
  }

  const overlay = (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1200 }}>
      {/* Dim backdrop — click to skip. Non-modal: does not trap focus. */}
      <div
        onClick={dismiss}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }}
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
