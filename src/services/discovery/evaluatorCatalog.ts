/** Fetch the kernel's evaluator catalogue (`discovery_evaluators`). */

import type { DiscoveryEvaluatorInfo } from '../../types/discovery';
import type { RunnerKernelSession } from '../experimentRunner';
import { newRequestId, replyMatches } from './requestId';

export const CATALOG_TIMEOUT_MS = 15_000;

export type CatalogResult = { ok: true; evaluators: DiscoveryEvaluatorInfo[] } | { ok: false; error: string };

export function fetchEvaluators(session: RunnerKernelSession, timeoutMs = CATALOG_TIMEOUT_MS): Promise<CatalogResult> {
  return new Promise((resolve) => {
    const requestId = newRequestId('discovery_evaluators');
    let echoed = false;
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
      if (message.type === 'discovery_evaluators_result') {
        if (replyMatches(requestId, message.request_id)) finish({ ok: true, evaluators: message.evaluators });
      } else if (message.type === 'error' && message.phase === 'discovery' && !message.candidate_id) {
        // With an echoing kernel only our own id counts; an older kernel sends none (CR-M4).
        if (message.request_id !== undefined ? message.request_id === requestId : !echoed) finish({ ok: false, error: message.message });
      }
      if ((message as { request_id?: unknown }).request_id !== undefined) echoed = true;
    });
    try {
      void Promise.resolve(session.send({ type: 'discovery_evaluators', request_id: requestId })).catch((e: unknown) =>
        finish({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      );
    } catch (e) {
      finish({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
