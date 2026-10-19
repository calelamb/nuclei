export interface NucleiMarkProps {
  /** Rendered width and height in px. */
  size?: number;
  /** Accessible name. Omit when the mark is decorative (it is then hidden from assistive tech). */
  title?: string;
}

const SMALL_SIZE_PX = 16;
const STROKE_SMALL = 3;
const STROKE_DEFAULT = 2.6;

/** The Nuclei brand mark, a ket |n⟩. Draws in currentColor so it takes the surrounding text colour. */
export function NucleiMark({ size = 24, title }: NucleiMarkProps) {
  const a11y = title ? { role: 'img' as const, 'aria-label': title } : { 'aria-hidden': true as const };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="4 2 28 28"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={size <= SMALL_SIZE_PX ? STROKE_SMALL : STROKE_DEFAULT}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...a11y}
    >
      <path d="M7 5V27" />
      <path d="M12.5 25V15.5C12.5 12.6 14.4 11 16.75 11S21 12.6 21 15.5V25" />
      <path d="M24.5 5L29 16L24.5 27" />
    </svg>
  );
}
