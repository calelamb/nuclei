export interface BottomPanelPresenceInput {
  /** The registry says the Terminal or full histogram is visible. */
  readonly panelVisible: boolean;
  readonly hasResult: boolean;
  /** The Terminal holds something worth reading (separators and run summaries do not count). */
  readonly hasOutput: boolean;
}

/**
 * The bottom panel mounts when the registry shows it, or when a result arrived alongside real
 * output. A silent run (result, nothing printed) leaves the editor at full height: the chip and
 * Bloch panel already show the outcome.
 */
export function shouldRenderBottomPanel({ panelVisible, hasResult, hasOutput }: BottomPanelPresenceInput): boolean {
  return panelVisible || (hasResult && hasOutput);
}
