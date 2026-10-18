import { forwardRef, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import { ICON_SIZE, ICON_STROKE } from '../../styles/tokens';
import { IconButton } from './IconButton';
import { TextInput, type TextInputProps } from './TextInput';

export interface SearchFieldProps extends Omit<TextInputProps, 'value' | 'onChange' | 'leadingIcon' | 'trailing' | 'type'> {
  value: string;
  onValueChange: (next: string) => void;
  /** Accessible name; required because the magnifier is decorative. */
  'aria-label': string;
}

/**
 * The one search box: a TextInput with a leading magnifier, a Clear button once there is text, and Escape that
 * clears a non-empty query first and only then blurs, so a single key never both clears and leaves.
 */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onValueChange, onKeyDown, ...rest },
  ref,
) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || e.key !== 'Escape') return;
    if (value !== '') {
      e.preventDefault();
      e.stopPropagation();
      onValueChange('');
    } else {
      e.currentTarget.blur();
    }
  };
  return (
    <TextInput
      {...rest}
      ref={ref}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      onKeyDown={handleKeyDown}
      leadingIcon={<Search size={ICON_SIZE.sm} strokeWidth={ICON_STROKE} />}
      trailing={value !== ''
        ? (
          <IconButton
            size="sm"
            aria-label="Clear search"
            onClick={() => onValueChange('')}
            onMouseDown={(e) => e.preventDefault()}
          >
            <X size={ICON_SIZE.xs} strokeWidth={ICON_STROKE} />
          </IconButton>
        )
        : undefined}
    />
  );
});
