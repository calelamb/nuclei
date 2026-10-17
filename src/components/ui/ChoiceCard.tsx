import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { cx } from './cx';

export interface ChoiceCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  title: ReactNode;
  description: ReactNode;
  /** Colour of the 3px left stripe and the hover/focus border. Any CSS colour. */
  accent: string;
}

/**
 * Large selectable card (onboarding, chooser screens). The accent stripe is
 * drawn with border-left-color only, so hover/focus never replaces it and no
 * border shorthand is mixed with a longhand (React warns about that).
 */
export const ChoiceCard = forwardRef<HTMLButtonElement, ChoiceCardProps>(function ChoiceCard(
  { title, description, accent, className, style, type = 'button', ...rest },
  ref,
) {
  const accentStyle = { ...style, '--choice-accent': accent } as CSSProperties;
  return (
    <button {...rest} ref={ref} type={type} className={cx('nuclei-choice-card', className)} style={accentStyle}>
      <span className="nuclei-choice-card__title">{title}</span>
      <span className="nuclei-choice-card__desc">{description}</span>
    </button>
  );
});
