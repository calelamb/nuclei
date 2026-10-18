/** Words in a panel title that stay capitalised in a sentence-case label. */
const PROPER_WORDS = new Set(['Bloch', 'Dirac', 'QEC', 'Histogram']);

function sentenceCase(title: string): string {
  return title
    .split(' ')
    .map((word) => (PROPER_WORDS.has(word) ? word : word.toLowerCase()))
    .join(' ');
}

/** "Toggle circuit panel", "Toggle Bloch sphere panel", but never "Toggle terminal panel panel" or "Toggle Histogram tab panel". */
export function panelToggleLabel(title: string): string {
  const name = sentenceCase(title);
  return /\b(panel|tab|chip)$/.test(name) || /\bpanel\b/.test(name) ? `Toggle ${name}` : `Toggle ${name} panel`;
}
