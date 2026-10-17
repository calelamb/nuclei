export type TokenKind = 'keyword' | 'string' | 'number' | 'comment' | 'plain';
export interface CodeToken { text: string; kind: TokenKind }

const KEYWORDS = new Set([
  // Python
  'import', 'from', 'as', 'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or',
  'with', 'lambda', 'None', 'True', 'False', 'try', 'except', 'finally', 'raise', 'pass', 'break', 'continue', 'yield', 'print',
  // Q# and CUDA-Q
  'operation', 'function', 'namespace', 'open', 'use', 'let', 'mutable', 'set', 'using', 'within', 'apply', 'repeat', 'until', 'fixup',
]);

// comment | string | number | identifier (anything else is plain text between matches)
const TOKEN = /(#[^\n]*|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)/g;

/** A small, dependency-free tokenizer for Python / Q# snippets in chat. Unknown text stays plain. */
export function highlightCode(code: string): CodeToken[] {
  const out: CodeToken[] = [];
  let last = 0;
  const push = (text: string, kind: TokenKind) => {
    if (text) out.push({ text, kind });
  };
  for (const m of code.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    push(code.slice(last, at), 'plain');
    if (m[1] !== undefined) push(m[0], 'comment');
    else if (m[2] !== undefined) push(m[0], 'string');
    else if (m[3] !== undefined) push(m[0], 'number');
    else push(m[0], KEYWORDS.has(m[0]) ? 'keyword' : 'plain');
    last = at + m[0].length;
  }
  push(code.slice(last), 'plain');
  return out;
}
