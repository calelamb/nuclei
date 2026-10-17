import type { Command } from './CommandPalette';

const SCORE = {
  exact: 100,
  prefix: 90,
  wordStart: 75,
  substring: 60,
  keywordWord: 50,
  keywordSubstring: 40,
  category: 30,
  subsequence: 15,
} as const;

function isSubsequence(q: string, t: string): boolean {
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function startsAWord(text: string, token: string): boolean {
  return text.split(/[^a-z0-9]+/).some((w) => w.startsWith(token));
}

/** Score one query token against one command. 0 means no match. */
function scoreToken(cmd: Command, token: string): number {
  const label = cmd.label.toLowerCase();
  if (label === token) return SCORE.exact;
  if (label.startsWith(token)) return SCORE.prefix;
  if (startsAWord(label, token)) return SCORE.wordStart;
  if (label.includes(token)) return SCORE.substring;
  const keywords = (cmd.keywords ?? []).map((k) => k.toLowerCase());
  if (keywords.some((k) => k.startsWith(token))) return SCORE.keywordWord;
  if (keywords.some((k) => k.includes(token))) return SCORE.keywordSubstring;
  if (cmd.category.toLowerCase().startsWith(token)) return SCORE.category;
  if (token.length >= 3 && isSubsequence(token, label)) return SCORE.subsequence;
  return 0;
}

/**
 * Filter and rank palette commands. Every whitespace-separated token must
 * match; a command's score is the sum of its token scores, so exact/prefix
 * label hits beat keyword and fuzzy ones. Stable for equal scores.
 */
export function rankCommands(commands: readonly Command[], query: string): Command[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...commands];
  const scored: Array<{ cmd: Command; score: number; index: number }> = [];
  commands.forEach((cmd, index) => {
    let total = 0;
    for (const token of tokens) {
      const s = scoreToken(cmd, token);
      if (s === 0) return;
      total += s;
    }
    scored.push({ cmd, score: total, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.cmd);
}
