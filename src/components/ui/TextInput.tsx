import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  invalid?: boolean;
  /** Use the mono font (paths, identifiers, numbers). */
  mono?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { size = 'md', invalid = false, mono = false, className, type = 'text', ...rest },
  ref,
) {
  return (
    <input
      {...rest}
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cx('nuclei-input', `nuclei-input--${size}`, mono && 'nuclei-input--mono', className)}
    />
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
