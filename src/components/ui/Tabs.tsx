import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

export interface TabOption<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
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
      listRef.current?.querySelector<HTMLElement>(`[data-value="${target}"]`)?.focus();
    });
  };

  return (
    <div ref={listRef} role="tablist" aria-label={ariaLabel} className={cx('nuclei-tabs', className)} onKeyDown={onKeyDown}>
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
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
