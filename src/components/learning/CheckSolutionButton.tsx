import { CheckCircle } from 'lucide-react';
import { Button, Tooltip } from '../ui';

interface Props {
  /** False when the code changed since the last run: the button stays put but cannot grade stale results. */
  ready: boolean;
  onCheck: () => void;
}

export const CHECK_STALE_HINT = 'Run your edited code first';

/**
 * Check solution that never disappears. While the last run is out of date it stays focusable
 * (aria-disabled, not disabled) so its reason is reachable by keyboard and hover.
 */
export function CheckSolutionButton({ ready, onCheck }: Props) {
  if (ready) {
    return <Button onClick={onCheck} icon={<CheckCircle size={12} aria-hidden="true" />}>Check solution</Button>;
  }
  return (
    <Tooltip label={CHECK_STALE_HINT}>
      <button
        type="button"
        aria-disabled="true"
        onClick={(e) => e.preventDefault()}
        className="nuclei-btn nuclei-btn--secondary nuclei-btn--md exercise__check--waiting"
      >
        <CheckCircle size={12} aria-hidden="true" />
        Check solution
      </button>
    </Tooltip>
  );
}
