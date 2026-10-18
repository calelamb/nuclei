/**
 * Plain-language versions of the schema validator's messages for the broken
 * experiment card. The validator speaks in Zod ("expected object, received
 * string"); a person fixing a YAML file needs "backend should be an object".
 */
const MISSING = /^(.+?): Invalid input: expected (\w+), received undefined$/;
const WRONG_TYPE = /^(.+?): Invalid input: expected (\w+), received (\w+)$/;

const TOO_SMALL = /^(.+?): Too small: expected (\w+) to (?:be|have) (>=?|<=?)\s*(-?[\d.]+)(?: (\w+))?$/;
const TOO_BIG = /^(.+?): Too big: expected (\w+) to (?:be|have) (<=?|>=?)\s*(-?[\d.]+)(?: (\w+))?$/;
const BARE_INVALID = /^(.+?): Invalid input$/;
const BAD_OPTION = /^(.+?): Invalid option: expected one of (.+)$/;

const BOUND_PHRASE: Readonly<Record<string, string>> = {
  '>': 'greater than',
  '>=': 'at least',
  '<': 'less than',
  '<=': 'at most',
};

const TYPE_NOUN: Readonly<Record<string, string>> = {
  string: 'text',
  number: 'a number',
  boolean: 'true or false',
  object: 'a group of fields',
  array: 'a list',
};

function describeExpected(expected: string): string {
  return TYPE_NOUN[expected] ?? expected;
}

export function explainValidationMessage(message: string): string {
  const missing = MISSING.exec(message);
  if (missing) return `“${missing[1]}” is required but missing.`;
  const wrong = WRONG_TYPE.exec(message);
  if (wrong) {
    const found = wrong[3] === 'string' ? 'plain text' : describeExpected(wrong[3]);
    return `“${wrong[1]}” should be ${describeExpected(wrong[2])}, not ${found}.`;
  }
  const bound = TOO_SMALL.exec(message) ?? TOO_BIG.exec(message);
  if (bound) {
    const unit = bound[5] ? ` ${bound[4] === '1' ? bound[5].replace(/s$/, '') : bound[5]}` : '';
    return `“${bound[1]}” must be ${BOUND_PHRASE[bound[3]] ?? bound[3]} ${bound[4]}${unit}.`;
  }
  const option = BAD_OPTION.exec(message);
  if (option) return `“${option[1]}” must be one of ${option[2]}.`;
  const bare = BARE_INVALID.exec(message);
  if (bare) return `“${bare[1]}” has a value the experiment format does not accept.`;
  return message;
}

export function problemCountLabel(count: number): string {
  return `${count} problem${count === 1 ? '' : 's'}`;
}
