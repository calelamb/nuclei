/** "Toggle Circuit panel", but never "Toggle Histogram (bottom panel) panel". */
export function panelToggleLabel(title: string): string {
  return /\bpanel\b/i.test(title) ? `Toggle ${title}` : `Toggle ${title} panel`;
}
