import { useCallback, useEffect, useRef, type HTMLAttributes, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from 'react';
import { cx } from './cx';
import './Table.css';

export interface TableProps {
  /** Accessible name of the table (also makes the scroll region keyboard-focusable). */
  label: string;
  /** Tighter row padding for dense data (compare views, wizard previews). */
  dense?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * The one data table: sticky uppercase header, tabular numerals, right-aligned
 * numeric columns. The scroll wrapper is focusable so keyboard users can pan
 * wide tables, and fades its right edge while columns are clipped.
 */
export function Table({ label, dense = false, className, children }: TableProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const syncOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const overflowing = el.scrollWidth > el.clientWidth + 1;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    el.dataset.overflow = String(overflowing);
    el.tabIndex = overflowing ? 0 : -1;
    el.dataset.scrolledEnd = String(atEnd);
  }, []);

  useEffect(() => {
    syncOverflow();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(syncOverflow);
    observer.observe(el);
    const table = el.firstElementChild;
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [syncOverflow]);

  return (
    <div ref={scrollRef} className="nuclei-table-scroll" role="region" aria-label={label} tabIndex={-1} onScroll={syncOverflow}>
      <table className={cx('nuclei-table', dense && 'nuclei-table--dense', className)} aria-label={label}>
        {children}
      </table>
    </div>
  );
}

export function Thead(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} />;
}

export function Tbody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function Tr(props: HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} />;
}

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
  /** Keep the header's original casing (run names, ids). */
  plain?: boolean;
}

export function Th({ numeric = false, plain = false, className, scope = 'col', ...rest }: ThProps) {
  return <th {...rest} scope={scope} className={cx(numeric && 'nuclei-table__num', plain && 'nuclei-table__plain', className)} />;
}

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
  /** Proportional sans text (labels) instead of tabular mono. */
  text?: boolean;
  muted?: boolean;
}

export function Td({ numeric = false, text = false, muted = false, className, ...rest }: TdProps) {
  return <td {...rest} className={cx(numeric && 'nuclei-table__num', text && 'nuclei-table__text', muted && 'nuclei-table__muted', className)} />;
}
