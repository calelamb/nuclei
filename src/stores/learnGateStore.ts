import { create } from 'zustand';

/**
 * The Learn workspace gate. Nuclei is research-first: lessons, challenges,
 * tracks, capstones and the tutor persona stay in the build but are hidden
 * unless this flag is on (Settings → General → "Learning workspace", or the
 * `?learn` link on the web build). Existing Learn progress is never touched;
 * it simply stays in storage while the gate is off.
 *
 * Deliberately dependency-free so every store can consult it without risking
 * an import cycle. The workspace mode itself is derived from it in
 * `workspaceStore` via `effectiveWorkspaceMode`.
 */

/** localStorage key of the persisted flag ('1' = on; absent = off). */
export const LEARN_ENABLED_KEY = 'nuclei:learn_enabled';

/** The query parameter that switches the gate on from a shared link. */
export const LEARN_QUERY_PARAM = 'learn';

type Mode = 'learn' | 'research';

/** The mode actually in force: Learn only exists while the gate is on. */
export function effectiveWorkspaceMode(stored: Mode, learnEnabled: boolean): Mode {
  return learnEnabled ? stored : 'research';
}

/** Whether a mode may be entered right now. */
export function canEnterMode(mode: Mode, learnEnabled: boolean): boolean {
  return mode !== 'learn' || learnEnabled;
}

/** True when the query string carries `learn` (bare, `=1`, `=true`), and not an explicit `=0` / `=false` / `=off`. */
export function learnParamRequested(search: string): boolean {
  const params = new URLSearchParams(search);
  if (!params.has(LEARN_QUERY_PARAM)) return false;
  const value = (params.get(LEARN_QUERY_PARAM) ?? '').trim().toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'off';
}

function loadLearnEnabled(): boolean {
  try {
    return localStorage.getItem(LEARN_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

function persistLearnEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(LEARN_ENABLED_KEY, '1');
    else localStorage.removeItem(LEARN_ENABLED_KEY);
  } catch {
    /* restricted environment (e.g. private browsing) — non-critical */
  }
}

interface LearnGateState {
  learnEnabled: boolean;
  setLearnEnabled: (enabled: boolean) => void;
}

export const useLearnGateStore = create<LearnGateState>((set) => ({
  learnEnabled: loadLearnEnabled(),
  setLearnEnabled: (enabled) => {
    persistLearnEnabled(enabled);
    set({ learnEnabled: enabled });
  },
}));

/** Non-reactive read for store actions and event handlers. */
export function isLearnEnabled(): boolean {
  return useLearnGateStore.getState().learnEnabled;
}

/**
 * Read once at startup: a `learn` query parameter turns the gate on (persisted).
 * Never turns it off, so a stale link can't hide Learn from someone who enabled it.
 */
export function applyLearnQueryParam(search: string): void {
  if (learnParamRequested(search) && !isLearnEnabled()) useLearnGateStore.getState().setLearnEnabled(true);
}
