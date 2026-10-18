/**
 * Plain-language versions of the schema validator's messages for the broken
 * experiment card. The validator speaks in Zod ("expected object, received
 * string"); a person fixing a YAML file needs "backend should be an object".
 */
const MISSING = /^(.+?): Invalid input: expected (\w+), received undefined$/;
const WRONG_TYPE = /^(.+?): Invalid input: expected (\w+), received (\w+)$/;

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
  return message;
}

export function problemCountLabel(count: number): string {
  return `${count} problem${count === 1 ? '' : 's'}`;
}
