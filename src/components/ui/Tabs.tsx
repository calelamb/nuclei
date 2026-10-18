import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

export interface TabOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  /** Optional leading icon (lucide at ICON_SIZE.sm); decorative, so give icon-only tabs a `title`. */
  icon?: ReactNode;
  /** Optional trailing count, rendered as quiet tabular text. */
  count?: number;
  /** Tooltip and accessible name override (required for an icon-only tab). */
  title?: string;
}

export interface TabsProps<T extends string> {
  value: T;
  options: ReadonlyArray<TabOption<T>>;
  onChange: (next: T) => void;
  'aria-label': string;
  className?: string;
}

/**
 * Tab strip (WAI-ARIA tabs, automatic activation). One tab stop; Left/Right
 * move and select, Home/End jump. Panels are the caller's (role="tabpanel").
 */
export function Tabs<T extends string>({ value, options, onChange, 'aria-label': ariaLabel, className }: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const enabled = options.filter((o) => !o.disabled);
  const [overflow, setOverflow] = useState<'none' | 'end' | 'start' | 'both'>('none');

  // A scrollable strip fades its clipped edge so hidden tabs are discoverable.
  const measure = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setOverflow(start && end ? 'both' : start ? 'start' : end ? 'end' : 'none');
  }, []);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    const frame = requestAnimationFrame(measure);
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(frame);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [measure, options.length]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = enabled.findIndex((o) => o.value === value);
    let next: TabOption<T> | undefined;
    if (e.key === 'ArrowRight') next = enabled[(at + 1) % enabled.length];
    else if (e.key === 'ArrowLeft') next = enabled[(at - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    const target = next.value;
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector<HTMLElement>(`[data-value="${target}"]`);
      el?.focus();
      el?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    });
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      data-overflow={overflow}
      className={cx('nuclei-tabs', className)}
      onKeyDown={onKeyDown}
      onScroll={measure}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            id={`${baseId}-${o.value}`}
            aria-selected={selected}
            data-value={o.value}
            disabled={o.disabled}
            tabIndex={selected ? 0 : -1}
            className="nuclei-tabs__tab"
            title={o.title}
            aria-label={o.title && !o.label ? o.title : undefined}
            onClick={() => onChange(o.value)}
          >
            {o.icon && <span className="nuclei-tabs__icon" aria-hidden="true">{o.icon}</span>}
            {o.label}
            {o.count !== undefined && <span className="nuclei-tabs__count">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
