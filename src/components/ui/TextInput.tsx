import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
  /** Use the mono font (paths, identifiers, numbers). */
  mono?: boolean;
  /** Decorative icon inside the left edge (e.g. a lucide Search at ICON_SIZE.sm). Hidden from assistive tech. */
  leadingIcon?: ReactNode;
  /** Control inside the right edge (e.g. a reveal or clear IconButton). Keep it a real, labelled control. */
  trailing?: ReactNode;
  /** Class for the wrapper that appears when an icon or trailing control is present. */
  wrapperClassName?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { size = 'md', invalid = false, mono = false, leadingIcon, trailing, wrapperClassName, className, type = 'text', ...rest },
  ref,
) {
  const input = (
    <input
      {...rest}
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cx(
        'nuclei-input', `nuclei-input--${size}`, mono && 'nuclei-input--mono',
        Boolean(leadingIcon) && 'nuclei-input--lead', Boolean(trailing) && 'nuclei-input--trail', className,
      )}
    />
  );
  if (!leadingIcon && !trailing) return input;
  // The input itself keeps the border and the one focus indicator; the wrapper only positions the adornments.
  return (
    <span className={cx('nuclei-input-wrap', wrapperClassName)}>
      {leadingIcon && <span className="nuclei-input-wrap__lead" aria-hidden="true">{leadingIcon}</span>}
      {input}
      {trailing && <span className="nuclei-input-wrap__trail">{trailing}</span>}
    </span>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  mono?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { invalid = false, mono = false, className, ...rest },
  ref,
) {
  return (
    <textarea
      {...rest}
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx('nuclei-textarea', mono && 'nuclei-input--mono', className)}
    />
  );
});
