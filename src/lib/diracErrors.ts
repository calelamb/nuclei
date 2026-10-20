/**
 * Plain-language descriptions of Dirac (Anthropic API) failures. The raw
 * status/body is kept in `details` so it can sit behind "Copy details"
 * instead of being shown as assistant markdown.
 */
export type DiracErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'busy'
  | 'billing'
  | 'offline'
  | 'bad_request'
  | 'unknown';

export interface DiracErrorInfo {
  kind: DiracErrorKind;
  title: string;
  message: string;
  /** What the card offers as the next step. */
  action: 'update-key' | null;
  /** Raw technical detail for support / debugging. */
  details: string;
}

function extractApiMessage(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const msg = (parsed as { error?: { message?: unknown } })?.error?.message;
    if (typeof msg === 'string') return msg;
  } catch { /* not JSON */ }
  return '';
}

export function describeHttpError(status: number, body: string): DiracErrorInfo {
  const details = `HTTP ${status}\n${body}`.trim();
  const apiMessage = extractApiMessage(body);

  if (status === 401 || status === 403) {
    return {
      kind: 'auth',
      title: 'Your Anthropic key was rejected',
      message: 'Check that the key is current and copied in full, then save it again.',
      action: 'update-key',
      details,
    };
  }
  if (status === 429) {
    return {
      kind: 'rate_limit',
      title: 'Rate limited',
      message: 'Anthropic is asking for a short pause. Try again in a moment.',
      action: null,
      details,
    };
  }
  if (status >= 500) {
    return {
      kind: 'busy',
      title: 'Claude is busy right now',
      message: 'This is on Anthropic’s side. Wait a few seconds and send your message again.',
      action: null,
      details,
    };
  }
  if (status === 400 && /credit|billing/i.test(apiMessage)) {
    return {
      kind: 'billing',
      title: 'Your Anthropic account is out of credit',
      message: 'Add credit in the Anthropic console, then send your message again.',
      action: null,
      details,
    };
  }
  return {
    kind: status >= 400 && status < 500 ? 'bad_request' : 'unknown',
    title: 'Dirac could not answer',
    message: 'Something went wrong with that request. Try again, or copy the details if it keeps happening.',
    action: null,
    details,
  };
}

export function describeThrownError(error: unknown): DiracErrorInfo {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (error instanceof TypeError) {
    return {
      kind: 'offline',
      title: 'Can’t reach Dirac',
      message: 'You may be offline. Check your connection and send your message again.',
      action: null,
      details: text,
    };
  }
  return {
    kind: 'unknown',
    title: 'Dirac could not answer',
    message: 'Something went wrong. Try again, or copy the details if it keeps happening.',
    action: null,
    details: text,
  };
}
