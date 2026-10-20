import { useCallback, type CSSProperties, type KeyboardEventHandler } from 'react';
import { baseNameSelectionEnd } from './nameInputSelection';

interface ExplorerNameInputProps {
  value: string;
  ariaLabel: string;
  /** Select only the base name (files); folders and packages select everything. */
  selectBaseName: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
  placeholder?: string;
  invalid?: boolean;
  /** Id of the element that explains the problem (the inline alert). */
  describedBy?: string;
  style: CSSProperties;
}

/**
 * The inline name field for create and rename. On mount it takes focus and
 * selects the base name so typing replaces `untitled` and keeps `.py`.
 */
export function ExplorerNameInput({
  value, ariaLabel, selectBaseName, onChange, onBlur, onKeyDown, placeholder, style, invalid, describedBy,
}: ExplorerNameInputProps) {
  const attach = useCallback((el: HTMLInputElement | null) => {
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, selectBaseName ? baseNameSelectionEnd(el.value) : el.value.length);
    // Only on mount: later value changes must not reset the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <input
      ref={attach}
      aria-label={ariaLabel}
      aria-invalid={invalid ? true : undefined}
      aria-describedby={describedBy}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      style={style}
    />
  );
}
