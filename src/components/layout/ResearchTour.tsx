import { Button } from '../ui';
import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useResearchTourStore, RESEARCH_TOUR_STEP_COUNT } from '../../stores/researchTourStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useProjectStore } from '../../stores/projectStore';
import { isWebBuild } from '../../platform/buildTarget';
import { researchTourSteps } from './researchTourSteps';
import { useNavigationStore, type NavView } from '../../stores/navigationStore';
import { placeTourCard, TOUR_CARD_WIDTH } from './tourPlacement';
import './researchTour.css';

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

const EDITOR_SELECTOR = '.monaco-editor textarea, [aria-label="Editor content"]';
const MODE_CHIP_SELECTOR = '[aria-label="Switch workspace mode"]';
const EDITOR_WAIT_MS = 500;

/**
 * Put focus back where the person was. The editor may be mid-remount (the QEC
 * takeover unmounts Monaco during the tour), so wait briefly for it, give up
 * if the person has already focused something, and fall back to the mode chip.
 */
function restoreFocus(opener: HTMLElement | null) {
  if (opener && document.contains(opener)) {
    opener.focus();
    return;
  }
  const deadline = performance.now() + EDITOR_WAIT_MS;
  const attempt = () => {
    // The editor can be mounted yet hidden (display: none) while the takeover is still on screen; focus() then does nothing, so keep waiting until it sticks.
    const editor = document.querySelector<HTMLElement>(EDITOR_SELECTOR);
    if (editor) {
      editor.focus();
      if (document.activeElement === editor) return;
    }
    const focusMoved = document.activeElement !== null && document.activeElement !== document.body;
    if (focusMoved) return;
    if (performance.now() >= deadline) {
      document.querySelector<HTMLElement>(MODE_CHIP_SELECTOR)?.focus();
      return;
    }
    requestAnimationFrame(attempt);
  };
  attempt();
}

export function ResearchTour() {
  const active = useResearchTourStore((s) => s.active);
  const step = useResearchTourStore((s) => s.step);
  const next = useResearchTourStore((s) => s.next);
  const prev = useResearchTourStore((s) => s.prev);
  const dismiss = useResearchTourStore((s) => s.dismiss);
  const [rect, setRect] = useState<Rect | null>(null);
  const [sidebarRight, setSidebarRight] = useState<number | null>(null);
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
    const sidebar = document.querySelector<HTMLElement>('[data-tour-sidebar]');
    setSidebarRight(sidebar ? sidebar.getBoundingClientRect().right : null);
  }, [current.target]);

  // Each step shows the pane it describes. The view the student had is put back when the tour ends,
  // unless they navigated somewhere else themselves meanwhile.
  const tourView = useRef<{ readonly prior: NavView | null; readonly shown: NavView | null } | null>(null);
  useEffect(() => {
    if (!active) return undefined;
    const nav = useNavigationStore.getState();
    const record = tourView.current ?? { prior: nav.activeView, shown: null };
    tourView.current = record;
    if (current.view && nav.activeView !== current.view) {
      nav.setActiveView(current.view);
      tourView.current = { ...record, shown: current.view };
    }
    return undefined;
  }, [active, current.view]);
  useEffect(() => {
    if (active) return;
    const record = tourView.current;
    tourView.current = null;
    if (record?.shown && useNavigationStore.getState().activeView === record.shown) {
      useNavigationStore.getState().setActiveView(record.prior);
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    // Measure after paint so the target's layout is settled (and to keep the
    // measurement out of the synchronous effect body).
    const raf = requestAnimationFrame(measure);
    // The sidebar for this step mounts and settles a beat later: measure once more so the card clears it.
    const settle = window.setTimeout(measure, 220);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      window.removeEventListener('resize', measure);
    };
  }, [active, measure]);

  // Whatever had focus before the tour (the status-bar chip, the editor) gets it back when the
  // tour ends by Escape, Skip or Done; when that element is gone, the editor does.
  useEffect(() => {
    if (!active) return undefined;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    return () => {
      restoreFocus(opener);
    };
  }, [active]);

  // Focus lands on the primary button for every step, and stays in the card: anything that
  // pulls it into a text field behind the dim (Monaco mounting, a late focus call) is undone,
  // so typing and Tab can never edit code under the tour.
  useEffect(() => {
    if (!active) return undefined;
    primaryRef.current?.focus();
    const frame = requestAnimationFrame(() => primaryRef.current?.focus());
    const keepInCard = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || cardRef.current?.contains(target)) return;
      const editable = target.matches('textarea, input, select, [contenteditable="true"]');
      if (editable) primaryRef.current?.focus();
    };
    document.addEventListener('focusin', keepInCard);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('focusin', keepInCard); };
  }, [active, step]);

  useEffect(() => {
    if (!active) return;
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

  // Card placement relative to the spotlighted target, kept inside the window and clear of the open sidebar.
  const card = rect ? placeTourCard(rect, current.placement, { width: window.innerWidth, height: window.innerHeight }, sidebarRight) : null;
  // Target not found (e.g. rail item hidden): centre the card.
  const cardStyle: React.CSSProperties = card
    ? { left: card.left, top: card.top, bottom: card.bottom }
    : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };

  // Click-catcher that leaves a hole over the target so it stays interactive/lit.
  const hole = rect
    ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.left - 4}px ${rect.top - 4}px, ${rect.left - 4}px ${rect.top + rect.height + 4}px, ${rect.left + rect.width + 4}px ${rect.top + rect.height + 4}px, ${rect.left + rect.width + 4}px ${rect.top - 4}px, ${rect.left - 4}px ${rect.top - 4}px)`
    : undefined;

  const overlay = (
    <div className="research-tour">
      {/* Click-catcher outside the target (click to skip). The dim is the spotlight's
          shadow below, so the target itself is never darkened. */}
      <div
        className={rect ? 'research-tour__catcher' : 'research-tour__catcher research-tour__catcher--dim'}
        onClick={dismiss}
        style={{ clipPath: hole }}
      />
      {/* Spotlight ring around the target. */}
      {rect && (
        <div
          className="research-tour__spot"
          style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="research-tour-title"
        className="research-tour__card"
        style={{ ...cardStyle, width: TOUR_CARD_WIDTH }}
      >
        {rect && card?.arrow && (
          <span
            aria-hidden="true"
            className={current.placement === 'above' ? 'research-tour__arrow research-tour__arrow--down' : 'research-tour__arrow research-tour__arrow--left'}
            style={current.placement === 'above' ? undefined : { top: Math.max(12, rect.top + rect.height / 2 - (card.top ?? 0) - 5) }}
          />
        )}
        <div className="research-tour__meta">
          <span className="research-tour__eyebrow">Research tour</span>
          <span className="research-tour__count">{step + 1} / {RESEARCH_TOUR_STEP_COUNT}</span>
        </div>
        <div id="research-tour-title" className="research-tour__title">{current.title}</div>
        <div aria-live="polite" className="research-tour__body">{current.body}</div>
        <div className="research-tour__actions">
          <Button size="sm" variant="ghost" onClick={dismiss}>Skip</Button>
          <div style={{ flex: 1 }} />
          {step > 0 && <Button size="sm" onClick={prev}>Back</Button>}
          <Button size="sm" variant="primary" ref={primaryRef} onClick={next}>
            {isLast ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
