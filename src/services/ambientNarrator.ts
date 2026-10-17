import type { CircuitSnapshot, SimulationResult } from '../types/quantum';
import { useDiracStore } from '../stores/diracStore';
import { useSettingsStore } from '../stores/settingsStore';
import { narrateParse, narrateResult } from './narration';

/**
 * Cost guard for ambient narration. Every narration is a paid Claude call, so
 * it must never fire per keystroke. A call is made only when ALL hold:
 *  - the user turned "Ambient narration" on (off by default),
 *  - an API key is present,
 *  - the editor has been idle for NARRATION_IDLE_MS,
 *  - the circuit's gates actually changed since the last narrated circuit,
 *  - at least NARRATION_MIN_INTERVAL_MS passed since the previous call.
 * Each request carries a sequence id; an answer older than the newest request
 * is dropped so lines never arrive out of order.
 */
export const NARRATION_IDLE_MS = 3000;
export const NARRATION_MIN_INTERVAL_MS = 10000;

let sequence = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let lastCallAt = Number.NEGATIVE_INFINITY;
let lastSignature: string | null = null;

export function gateSignature(snapshot: CircuitSnapshot): string {
  return JSON.stringify([
    snapshot.framework,
    snapshot.qubit_count,
    snapshot.gates.map((g) => [g.type, g.targets, g.controls]),
  ]);
}

function isEnabled(): boolean {
  const enabled = useSettingsStore.getState().dirac.ambientNarration;
  const key = useDiracStore.getState().apiKey;
  return enabled && typeof key === 'string' && key.trim().length > 0;
}

function clearIdleTimer(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/** Clears timers and counters. Used on disable and by tests. */
export function resetAmbientNarrator(): void {
  clearIdleTimer();
  sequence += 1;
  lastCallAt = Number.NEGATIVE_INFINITY;
  lastSignature = null;
}

function deliver(
  id: number,
  kind: 'parse' | 'result',
  pending: Promise<string | null>,
): void {
  pending
    .then((line) => {
      if (id !== sequence || !line) return; // stale or empty
      useDiracStore.getState().pushAmbient({ kind, text: line });
    })
    .catch(() => { /* ambient AI must never throw into the UI */ });
}

export function requestParseNarration(code: string, snapshot: CircuitSnapshot): void {
  clearIdleTimer();
  if (!isEnabled()) return;
  const signature = gateSignature(snapshot);
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!isEnabled() || signature === lastSignature) return;
    const now = Date.now();
    const wait = lastCallAt + NARRATION_MIN_INTERVAL_MS - now;
    if (wait > 0) {
      // Re-arm instead of dropping, so the final state of a long edit still gets narrated once.
      idleTimer = setTimeout(() => requestParseNarration(code, snapshot), wait);
      return;
    }
    lastCallAt = now;
    lastSignature = signature;
    sequence += 1;
    deliver(sequence, 'parse', narrateParse({ code, snapshot }));
  }, NARRATION_IDLE_MS);
}

export function requestResultNarration(
  code: string,
  snapshot: CircuitSnapshot | null,
  result: SimulationResult,
): void {
  if (!isEnabled()) return;
  const now = Date.now();
  if (now - lastCallAt < NARRATION_MIN_INTERVAL_MS) return; // runs are explicit, but still capped
  lastCallAt = now;
  sequence += 1;
  deliver(sequence, 'result', narrateResult({ code, snapshot, result }));
}
