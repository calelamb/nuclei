/** Fetch the kernel's evaluator catalogue (`discovery_evaluators`). */

import type { DiscoveryEvaluatorInfo } from '../../types/discovery';
import type { RunnerKernelSession } from '../experimentRunner';

export const CATALOG_TIMEOUT_MS = 15_000;

export type CatalogResult = { ok: true; evaluators: DiscoveryEvaluatorInfo[] } | { ok: false; error: string };

export function fetchEvaluators(session: RunnerKernelSession, timeoutMs = CATALOG_TIMEOUT_MS): Promise<CatalogResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => finish({ ok: false, error: 'The kernel did not list its evaluators in time.' }),
      timeoutMs,
    );
    function finish(result: CatalogResult) {
      off();
      clearTimeout(timer);
      resolve(result);
    }
    const off = session.subscribe((message) => {
      if (message.type === 'discovery_evaluators_result') finish({ ok: true, evaluators: message.evaluators });
      else if (message.type === 'error' && message.phase === 'discovery' && !message.candidate_id) {
        finish({ ok: false, error: message.message });
      }
    });
    try {
      void Promise.resolve(session.send({ type: 'discovery_evaluators' })).catch((e: unknown) =>
        finish({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      );
    } catch (e) {
      finish({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
