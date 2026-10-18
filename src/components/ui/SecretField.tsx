import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { IconButton } from './IconButton';
import { TextInput, type TextInputProps } from './TextInput';

export interface SecretFieldProps extends Omit<TextInputProps, 'type' | 'trailing' | 'leadingIcon'> {
  /** What is hidden, for the toggle's name: "Show API key" / "Hide API key". Default "value". */
  noun?: string;
}

/**
 * A password-style TextInput (API keys, tokens) with the reveal toggle inside the field, monospaced, never
 * autocompleted or spell-checked. The same 28/32px control as every other TextInput, so it lines up with a Save button.
 */
export const SecretField = forwardRef<HTMLInputElement, SecretFieldProps>(function SecretField(
  { noun = 'value', mono = true, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <TextInput
      autoComplete="off"
      spellCheck={false}
      {...rest}
      ref={ref}
      mono={mono}
      type={visible ? 'text' : 'password'}
      trailing={(
        <IconButton
          size="sm"
          aria-label={`${visible ? 'Hide' : 'Show'} ${noun}`}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} /> : <Eye size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />}
        </IconButton>
      )}
    />
  );
});
