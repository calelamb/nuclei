/**
 * PRD 14 — Quantum AI Lab design-system primitives. Every Trainability Lab
 * and Discovery Engine surface is composed from these + `charts.tsx`, styled
 * by `lab.css` (app tokens only — light and dark both work).
 */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X, type LucideIcon } from 'lucide-react';
import './lab.css';

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ── Shell ─────────────────────────────────────────────────────────────────

export function LabShell({
  children,
  label,
  className,
}: {
  children: ReactNode;
  /** Landmark name, e.g. "Trainability Lab". */
  label: string;
  className?: string;
}) {
  return (
    <section className={cx('lab', 'lab-shell', className)} aria-label={label}>
      {children}
    </section>
  );
}

export function LabShellBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('lab-shell__body', className)}>{children}</div>;
}

export function LabToolbar({
  icon: Icon,
  title,
  subtitle,
  leading,
  children,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  /** Right-aligned controls. */
  children?: ReactNode;
}) {
  return (
    <header className="lab-toolbar">
      {leading}
      <div className="lab-toolbar__title">
        {Icon && <Icon size={16} strokeWidth={1.9} aria-hidden style={{ color: 'var(--color-accent-quantum)', flexShrink: 0 }} />}
        <h1>{title}</h1>
        {subtitle && <span className="lab-toolbar__subtitle">{subtitle}</span>}
      </div>
      <div className="lab-toolbar__spacer" />
      {children && <div className="lab-toolbar__group">{children}</div>}
    </header>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────

export function LabCard({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  flush,
  'aria-label': ariaLabel,
  style,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** No body padding (tables, full-bleed charts). */
  flush?: boolean;
  'aria-label'?: string;
  style?: CSSProperties;
}) {
  const headingId = useId();
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <section
      className={cx('lab-card', className)}
      aria-labelledby={title !== undefined && !ariaLabel ? headingId : undefined}
      aria-label={ariaLabel}
      style={style}
    >
      {hasHeader && (
        <div className="lab-card__header">
          <div style={{ minWidth: 0 }}>
            {title !== undefined && (
              <h2 className="lab-card__title" id={headingId}>
                {title}
              </h2>
            )}
            {subtitle && <div className="lab-card__subtitle">{subtitle}</div>}
          </div>
          {actions && <div className="lab-card__actions">{actions}</div>}
        </div>
      )}
      <div className={cx(!flush && 'lab-card__body', bodyClassName)}>{children}</div>
    </section>
  );
}

export function LabSectionLabel({ children, as: As = 'h3' }: { children: ReactNode; as?: 'h3' | 'h4' | 'div' }) {
  return <As className="lab-section-label">{children}</As>;
}

// ── KPI ───────────────────────────────────────────────────────────────────

export function LabKpiStrip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="lab-kpis" role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function LabKpi({
  label,
  value,
  unit,
  detail,
  icon: Icon,
  delta,
  title,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  detail?: ReactNode;
  icon?: LucideIcon;
  /** Signed change; positive renders as an improvement when `deltaGood` is up. */
  delta?: { text: string; direction: 'up' | 'down' | 'flat'; good?: boolean } | null;
  title?: string;
}) {
  return (
    <div className="lab-kpi" title={title}>
      <div className="lab-kpi__label">
        {Icon && <Icon size={12} aria-hidden />}
        <span>{label}</span>
      </div>
      <div className="lab-kpi__value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {(detail || delta) && (
        <div className="lab-kpi__detail">
          {delta && delta.direction !== 'flat' && (
            <span
              className={cx(
                delta.good === undefined ? undefined : delta.good ? 'lab-delta--up' : 'lab-delta--down',
              )}
            >
              {delta.direction === 'up' ? '▲' : '▼'} {delta.text}
            </span>
          )}
          {delta && delta.direction !== 'flat' && detail ? ' · ' : null}
          {detail}
        </div>
      )}
    </div>
  );
}

// ── Pill ──────────────────────────────────────────────────────────────────

export type LabTone = 'neutral' | 'quantum' | 'success' | 'warning' | 'danger' | 'dirac';

export function LabPill({
  tone = 'neutral',
  icon: Icon,
  dot,
  live,
  outline,
  children,
  title,
}: {
  tone?: LabTone;
  icon?: LucideIcon;
  /** Leading status dot (color = tone). */
  dot?: boolean;
  /** Pulsing dot for in-progress states (reduced-motion safe). */
  live?: boolean;
  outline?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={cx('lab-pill', tone !== 'neutral' && `lab-pill--${tone}`, outline && 'lab-pill--outline')} title={title}>
      {Icon && <Icon size={12} aria-hidden />}
      {(dot || live) && <span className={cx('lab-dot', live && 'lab-dot--live')} aria-hidden />}
      {children}
    </span>
  );
}

// ── Buttons ───────────────────────────────────────────────────────────────

export interface LabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  /** Icon-only button; `aria-label` is required. */
  iconOnly?: boolean;
  shortcut?: string;
}

export function LabButton({
  variant = 'secondary',
  size,
  icon: Icon,
  iconOnly,
  shortcut,
  className,
  children,
  type = 'button',
  ...rest
}: LabButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'lab-button',
        variant !== 'secondary' && `lab-button--${variant}`,
        size && `lab-button--${size}`,
        iconOnly && 'lab-button--icon',
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={size === 'sm' ? 13 : 14} strokeWidth={2} aria-hidden />}
      {!iconOnly && children}
      {shortcut && !iconOnly && <span className="lab-kbd" aria-hidden>{shortcut}</span>}
    </button>
  );
}

// ── Segmented tabs ────────────────────────────────────────────────────────

export interface LabSegmentedItem<T extends string> {
  id: T;
  label: ReactNode;
  icon?: LucideIcon;
  badge?: ReactNode;
  disabled?: boolean;
}

export function LabSegmented<T extends string>({
  items,
  value,
  onChange,
  label,
  idPrefix,
}: {
  items: Array<LabSegmentedItem<T>>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  /** When set, tabs get ids `${idPrefix}-tab-${id}` and aria-controls `${idPrefix}-panel-${id}`. */
  idPrefix?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = items.filter((i) => !i.disabled);
  const focusAt = (id: T) => {
    const index = items.findIndex((i) => i.id === id);
    refs.current[index]?.focus();
  };
  return (
    <div
      className="lab-segmented"
      role="tablist"
      aria-label={label}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const at = enabled.findIndex((i) => i.id === value);
        let next = at;
        if (event.key === 'ArrowRight') next = (at + 1) % enabled.length;
        if (event.key === 'ArrowLeft') next = (at - 1 + enabled.length) % enabled.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = enabled.length - 1;
        const target = enabled[next];
        if (target) {
          onChange(target.id);
          focusAt(target.id);
        }
      }}
    >
      {items.map((item, index) => {
        const Icon = item.icon;
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-tab-${item.id}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${item.id}` : undefined}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            className="lab-segmented__item"
            onClick={() => onChange(item.id)}
          >
            {Icon && <Icon size={13} aria-hidden />}
            {item.label}
            {item.badge !== undefined && item.badge !== null && <span className="lab-segmented__badge">{item.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── Meter / progress ──────────────────────────────────────────────────────

export function LabMeter({
  label,
  value,
  max,
  format = (v) => String(v),
  tone,
}: {
  label: string;
  value: number;
  max: number;
  format?: (v: number) => string;
  tone?: 'warning' | 'danger';
}) {
  const fraction = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const autoTone = tone ?? (fraction >= 1 ? 'danger' : fraction >= 0.85 ? 'warning' : undefined);
  return (
    <div className="lab-meter">
      <div className="lab-meter__head">
        <span>{label}</span>
        <b>
          {format(value)}
          <span className="lab-dim"> / {format(max)}</span>
        </b>
      </div>
      <div
        className="lab-meter__track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.min(value, max)}
      >
        <div className={cx('lab-meter__fill', autoTone && `lab-meter__fill--${autoTone}`)} style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}

export function LabProgress({ value, label }: { value: number | null; label: string }) {
  const indeterminate = value === null || !Number.isFinite(value);
  const pct = indeterminate ? 0 : Math.min(100, Math.max(0, (value as number) * 100));
  return (
    <div
      className={cx('lab-progress', indeterminate && 'lab-progress--indeterminate')}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
    >
      <div className="lab-progress__fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Empty / skeleton / callout ────────────────────────────────────────────

export function LabEmptyState({
  icon: Icon,
  title,
  body,
  actions,
  compact,
}: {
  icon?: LucideIcon;
  title: string;
  body?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className="lab-empty" style={compact ? { minHeight: 120, padding: 'var(--space-5)' } : undefined}>
      {Icon && (
        <div className="lab-empty__icon" aria-hidden>
          <Icon size={20} strokeWidth={1.8} />
        </div>
      )}
      <p className="lab-empty__title">{title}</p>
      {body && <p className="lab-empty__body">{body}</p>}
      {actions && <div className="lab-empty__actions">{actions}</div>}
    </div>
  );
}

export function LabSkeleton({ height = 14, width = '100%', style }: { height?: number | string; width?: number | string; style?: CSSProperties }) {
  return <div className="lab-skeleton" aria-hidden style={{ height, width, ...style }} />;
}

const CALLOUT_ICON: Record<'info' | 'success' | 'warning' | 'danger', LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: OctagonAlert,
};

export function LabCallout({
  tone = 'info',
  children,
  title,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: ReactNode;
  children?: ReactNode;
}) {
  const Icon = CALLOUT_ICON[tone];
  return (
    <div className={cx('lab-callout', `lab-callout--${tone}`)} role={tone === 'danger' ? 'alert' : 'note'}>
      <Icon size={14} aria-hidden style={{ color: `var(--color-${tone === 'danger' ? 'danger' : tone})` }} />
      <div style={{ minWidth: 0 }}>
        {title && <div style={{ fontWeight: 600, marginBottom: children ? 2 : 0 }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

// ── Fields ────────────────────────────────────────────────────────────────

export function LabField({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="lab-field">
      <label className="lab-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? <div className="lab-field__error" role="alert">{error}</div> : hint ? <div className="lab-field__hint">{hint}</div> : null}
    </div>
  );
}

export function LabInput({ mono, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return <input className={cx('lab-input', mono && 'lab-input--mono', className)} {...rest} />;
}

export function LabSelect({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx('lab-select', className)} {...rest}>
      {children}
    </select>
  );
}

/** Numeric input that commits clamped integers/floats on blur or Enter. */
export function LabNumber({
  value,
  onCommit,
  min,
  max,
  step = 1,
  integer = true,
  id,
  'aria-label': ariaLabel,
  width = 88,
  disabled,
}: {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  id?: string;
  'aria-label'?: string;
  width?: number | string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    // Adopt an external value change (derived-state pattern, no effect).
    setSynced(value);
    setDraft(String(value));
  }
  const commit = () => {
    let next = Number(draft);
    if (!Number.isFinite(next)) {
      setDraft(String(value));
      return;
    }
    if (integer) next = Math.round(next);
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      className="lab-input lab-input--mono"
      inputMode={integer ? 'numeric' : 'decimal'}
      value={draft}
      step={step}
      disabled={disabled}
      style={{ width }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const base = Number(draft);
          const delta = e.key === 'ArrowUp' ? step : -step;
          let next = (Number.isFinite(base) ? base : value) + delta;
          if (min !== undefined) next = Math.max(min, next);
          if (max !== undefined) next = Math.min(max, next);
          setDraft(String(integer ? Math.round(next) : Number(next.toPrecision(10))));
        }
      }}
    />
  );
}

export function LabCode({ children, maxHeight, label }: { children: string; maxHeight?: number | string; label?: string }) {
  return (
    <pre className="lab-code" style={{ maxHeight }} aria-label={label} tabIndex={0}>
      {children}
    </pre>
  );
}

export function LabCitation({ label, url }: { label: string; url?: string | null }) {
  if (!url) return <span className="lab-citation">{label}</span>;
  return (
    <a className="lab-citation" href={url} target="_blank" rel="noreferrer noopener">
      {label}
    </a>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────

export interface LabTooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

/**
 * Fixed-position tooltip rendered in a portal; clamps to the viewport.
 * Charts own the hover state and pass client coordinates.
 */
export function LabTooltip({ state }: { state: LabTooltipState | null }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!state || !el) return;
    // Measure after mount and clamp to the viewport; mutate style directly so
    // pointer-move tooltips never trigger a second React render.
    const w = el.offsetWidth || 160;
    const h = el.offsetHeight || 60;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    let left = state.x + 14;
    let top = state.y + 14;
    if (left + w > vw - 8) left = state.x - w - 14;
    if (top + h > vh - 8) top = state.y - h - 14;
    el.style.left = `${Math.max(8, left)}px`;
    el.style.top = `${Math.max(8, top)}px`;
  }, [state]);
  if (!state || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={ref}
      className="lab lab-tooltip"
      role="tooltip"
      style={{ left: state.x + 14, top: state.y + 14, background: 'var(--lab-surface-3)' }}
    >
      {state.content}
    </div>,
    document.body,
  );
}

export function TooltipRows({ title, rows }: { title?: ReactNode; rows: Array<{ label: ReactNode; value: ReactNode; swatch?: string }> }) {
  return (
    <>
      {title && <div className="lab-tooltip__title">{title}</div>}
      {rows.map((row, i) => (
        <div className="lab-tooltip__row" key={i}>
          <span>
            {row.swatch && <span className="lab-swatch" style={{ background: row.swatch }} />}
            {row.label}
          </span>
          <b>{row.value}</b>
        </div>
      ))}
    </>
  );
}

// ── Drawer ────────────────────────────────────────────────────────────────

export function LabDrawer({
  open,
  onClose,
  title,
  subtitle,
  actions,
  children,
  label,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  label: string;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="lab">
      <div className="lab-drawer-scrim" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        className="lab-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        <div className="lab-drawer__header">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{title}</div>
            {subtitle && <div className="lab-muted" style={{ fontSize: 12, marginTop: 2 }}>{subtitle}</div>}
          </div>
          {actions}
          <LabButton variant="ghost" iconOnly icon={X} aria-label="Close" onClick={onClose} />
        </div>
        <div className="lab-drawer__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
