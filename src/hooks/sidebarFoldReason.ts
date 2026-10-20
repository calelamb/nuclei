let diracClaimedRoom = false;

/** Called by the room planner right before it folds the sidebar because Dirac just opened. */
export function noteDiracClaimedRoom(): void {
  diracClaimedRoom = true;
}

/** Whether the pending sidebar fold was Dirac claiming room; reading it clears it. */
export function consumeDiracClaimedRoom(): boolean {
  const value = diracClaimedRoom;
  diracClaimedRoom = false;
  return value;
}
