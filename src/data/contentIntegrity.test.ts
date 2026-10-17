import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { TRACKS } from './lessons/tracks';
import { QUANTUM_CHALLENGES } from './challenges';

interface Snippet {
  where: string;
  code: string;
  /** Only Python frameworks can be ast-parsed. */
  python: boolean;
}

const PYTHON_FRAMEWORKS = new Set(['qiskit', 'cirq', 'cuda-q', 'cudaq']);
const LITERAL_UNICODE_ESCAPE = /\\u[0-9a-fA-F]{4}/;

function lessonSnippets(): Snippet[] {
  return TRACKS.flatMap((track) =>
    track.lessons.flatMap((lesson) =>
      lesson.contentBlocks.flatMap((block, i): Snippet[] => {
        const where = `${track.id}/${lesson.id}#${i}`;
        if (block.type === 'demo') return [{ where: `${where} demo`, code: block.code, python: PYTHON_FRAMEWORKS.has(block.framework) }];
        if (block.type === 'exercise') return [{ where: `${where} exercise ${block.id}`, code: block.starterCode, python: PYTHON_FRAMEWORKS.has(block.framework) }];
        return [];
      }),
    ),
  );
}

function challengeSnippets(): Snippet[] {
  return QUANTUM_CHALLENGES.flatMap((c): Snippet[] => {
    const out: Snippet[] = Object.entries(c.starterCode).map(([fw, code]) => ({
      where: `challenge ${c.id} starter ${fw}`, code: code ?? '', python: fw !== 'qsharp' && fw !== 'stim',
    }));
    if (c.starter_template) out.push({ where: `challenge ${c.id} starter_template`, code: c.starter_template, python: true });
    if (c.referenceCode) out.push({ where: `challenge ${c.id} reference`, code: c.referenceCode, python: true });
    if (c.oracle) out.push({ where: `challenge ${c.id} oracle`, code: c.oracle.builderCode, python: true });
    return out;
  });
}

function parseErrors(snippets: Snippet[]): string[] {
  const py = snippets.filter((s) => s.python && s.code.trim().length > 0);
  const script = [
    'import ast, json, sys',
    'items = json.load(sys.stdin)',
    'errs = []',
    'for i, code in enumerate(items):',
    '    try: ast.parse(code)',
    '    except SyntaxError as e: errs.append([i, f"{e.msg} (line {e.lineno})"])',
    'print(json.dumps(errs))',
  ].join('\n');
  const stdout = execFileSync('python3', ['-I', '-c', script], {
    input: JSON.stringify(py.map((s) => s.code)),
    encoding: 'utf8',
  });
  return (JSON.parse(stdout) as Array<[number, string]>).map(([i, msg]) => `${py[i].where}: ${msg}`);
}

describe('lesson and challenge content integrity', () => {
  it('every Python code block parses', () => {
    expect(parseErrors([...lessonSnippets(), ...challengeSnippets()])).toEqual([]);
  });

  it('no code block contains a literal \\uXXXX escape', () => {
    const bad = [...lessonSnippets(), ...challengeSnippets()]
      .filter((s) => LITERAL_UNICODE_ESCAPE.test(s.code))
      .map((s) => s.where);
    expect(bad).toEqual([]);
  });

  it('no lesson or challenge prose contains a literal \\uXXXX escape', () => {
    const prose: Array<[string, string]> = [];
    for (const track of TRACKS) {
      for (const lesson of track.lessons) {
        prose.push([`${track.id}/${lesson.id} title`, lesson.title], [`${track.id}/${lesson.id} description`, lesson.description]);
        for (const block of lesson.contentBlocks) {
          if (block.type === 'text') prose.push([`${lesson.id} text`, block.markdown]);
          if (block.type === 'demo') prose.push([`${lesson.id} demo description`, block.description]);
          if (block.type === 'exercise') prose.push([`${lesson.id} exercise description`, block.description], [`${lesson.id} success`, block.successMessage]);
          if (block.type === 'concept-card') prose.push([`${lesson.id} concept`, block.explanation]);
        }
      }
    }
    for (const c of QUANTUM_CHALLENGES) {
      prose.push([`challenge ${c.id} title`, c.title], [`challenge ${c.id} description`, c.description]);
      c.constraints.forEach((t, i) => prose.push([`challenge ${c.id} constraint ${i}`, t]));
      c.hints.forEach((t, i) => prose.push([`challenge ${c.id} hint ${i}`, t]));
    }
    expect(prose.filter(([, text]) => LITERAL_UNICODE_ESCAPE.test(text)).map(([where]) => where)).toEqual([]);
  });
});
