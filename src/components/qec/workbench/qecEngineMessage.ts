export interface EngineFailureCopy {
  /** One sentence a person can act on. */
  headline: string;
  /** The raw message for a disclosure, or null when it adds nothing. */
  detail: string | null;
}

const DEFAULT_CAUSE_HINTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/python[^.]*not found|no such file.*python|python.*(enoent|missing)/i, "Python wasn't found."],
  [/timed? ?out|timeout/i, 'It did not respond in time.'],
  [/token|authenticat/i, 'It rejected the connection.'],
];

/**
 * Plain-language copy for a QEC Data Engine failure, keeping the raw exception
 * out of the main line (it moves to a disclosure).
 */
export function describeEngineFailure(raw: string | null, disconnected: boolean): EngineFailureCopy {
  const base = disconnected ? 'The QEC Data Engine stopped.' : "The QEC Data Engine couldn't start.";
  const message = raw?.trim() ?? '';
  const cause = DEFAULT_CAUSE_HINTS.find(([pattern]) => pattern.test(message))?.[1];
  return {
    headline: cause ? `${base} ${cause}` : base,
    detail: message.length > 0 ? message : null,
  };
}
