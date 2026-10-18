import { useDiracPanelStore } from '../../stores/diracPanelStore';
import { useDiracStore } from '../../stores/diracStore';

export const DIRAC_KEY_NOTICE_TITLE = 'Connect Dirac to use AI edits';
export const DIRAC_KEY_NOTICE_BODY = 'Add your Anthropic API key in the Dirac panel. It stays on this device.';

/** True when Dirac has no usable key. Reactive, so a surface switches the moment a key is saved. */
export function useHasDiracKey(): boolean {
  return useDiracStore((s) => Boolean(s.apiKey && s.apiKey.trim() !== ''));
}

/** Opens the Dirac panel on its key form and puts the caret in the key field. */
export function openDiracKeyEntry(): void {
  useDiracPanelStore.getState().focusInput();
}
