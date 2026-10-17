/** Returns an error message for a malformed Anthropic key, or '' when it is acceptable (empty means "clear"). */
export function validateApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed === '') return '';
  if (!trimmed.startsWith('sk-ant-')) return 'Key should start with "sk-ant-"';
  return '';
}
