import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (next: T) => void;
  'aria-label': string;
}

/**
 * A radiogroup of short options. One tab stop, arrow keys move and select
 * (WAI-ARIA radio group), so it is as keyboard-operable as a native select.
 */
export function SegmentedControl<T extends string>({ value, options, onChange, 'aria-label': ariaLabel }: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const at = options.findIndex((o) => o.value === value);
    const next = options[(at + step + options.length) % options.length];
    onChange(next.value);
    requestAnimationFrame(() => {
      groupRef.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus();
    });
  };

  return (
    <div ref={groupRef} role="radiogroup" aria-label={ariaLabel} className="nuclei-segmented" onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          data-value={o.value}
          tabIndex={o.value === value ? 0 : -1}
          className="nuclei-segmented__option"
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
