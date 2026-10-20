/**
 * Challenge descriptions open with "## <Title>", which the workspace header
 * already shows. Drop that first heading when it only repeats the title.
 */
export function stripLeadingTitle(markdown: string, title: string): string {
  const match = /^\s*#{1,3}[ \t]+(.+?)[ \t]*(?:\r?\n|$)/.exec(markdown);
  if (!match) return markdown;
  if (match[1].trim().toLowerCase() !== title.trim().toLowerCase()) return markdown;
  return markdown.slice(match[0].length).replace(/^\s*\n/, '');
}
