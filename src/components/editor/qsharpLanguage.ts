import type * as monaco from 'monaco-editor';

type Monaco = typeof monaco;

/** Monaco language id for Q#. Shared by the editor and file-extension map. */
export const QSHARP_LANGUAGE_ID = 'qsharp';

/**
 * Q# keywords. Covers declarations, bindings, control flow, functor
 * blocks, and the wordy operators (`not`/`and`/`or`).
 */
export const QSHARP_KEYWORDS = [
  'operation', 'function', 'namespace', 'import', 'open',
  'use', 'borrow', 'let', 'mutable', 'set',
  'if', 'elif', 'else', 'for', 'in', 'while', 'repeat', 'until', 'fixup',
  'within', 'apply', 'return', 'fail',
  'body', 'adjoint', 'controlled', 'is',
  'new', 'struct', 'internal',
  'not', 'and', 'or',
];

/** Built-in Q# types. Tokenized as `type` so themes color them. */
export const QSHARP_TYPES = [
  'Qubit', 'Result', 'Unit', 'Int', 'Double', 'Bool', 'String', 'BigInt',
  'Pauli', 'Range',
];

/**
 * Built-in literal constants. Tokenized as `number` — the Nuclei themes
 * define `number` but not a dedicated constant token, and these behave
 * like literals (Zero/One are Result values, PauliX etc. are Pauli values).
 */
export const QSHARP_CONSTANTS = [
  'Zero', 'One', 'PauliI', 'PauliX', 'PauliY', 'PauliZ', 'true', 'false',
];

/**
 * Monarch tokenizer for Q#. Emits only token names the Nuclei themes
 * cover (`keyword`, `type`, `string`, `number`, `comment`) plus Monaco
 * defaults (`identifier`, `operator`, `delimiter`, brackets).
 */
export const qsharpMonarchLanguage: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.qsharp',

  keywords: QSHARP_KEYWORDS,
  typeKeywords: QSHARP_TYPES,
  constants: QSHARP_CONSTANTS,

  operators: [
    '=', '==', '!=', '<', '>', '<=', '>=',
    '+', '-', '*', '/', '%', '^',
    '&&&', '|||', '^^^', '<<<', '>>>', '~~~',
    'w/', '<-', '->', '=>', '..', '...', '?', '|', '!',
  ],

  symbols: /[=><!~?:&|+\-*/^%.]+/,

  brackets: [
    { open: '(', close: ')', token: 'delimiter.parenthesis' },
    { open: '[', close: ']', token: 'delimiter.square' },
    { open: '{', close: '}', token: 'delimiter.curly' },
  ],

  tokenizer: {
    root: [
      // Interpolated strings: $"... {expr} ..." — must precede the
      // identifier rule so the `$` sigil isn't consumed as an identifier.
      [/\$"/, { token: 'string', next: '@interpolatedString' }],
      // Plain strings
      [/"/, { token: 'string', next: '@string' }],

      // Identifiers, keywords, types, constants ($ is not legal in Q# names)
      [/[a-zA-Z_]\w*/, {
        cases: {
          '@keywords': 'keyword',
          '@typeKeywords': 'type',
          '@constants': 'number',
          '@default': 'identifier',
        },
      }],

      { include: '@whitespace' },

      // Numbers — hex, float (with optional exponent), int. The negative
      // lookahead keeps range expressions like `0..n` tokenizing as
      // int / `..` operator / int instead of swallowing `0.`.
      [/0[xX][0-9a-fA-F]+/, 'number'],
      [/\d+\.(?!\.)\d*([eE][-+]?\d+)?/, 'number'],
      [/\.\d+([eE][-+]?\d+)?/, 'number'],
      [/\d+([eE][-+]?\d+)?/, 'number'],

      // Brackets and delimiters
      [/[{}()[\]]/, '@brackets'],
      [/[,;]/, 'delimiter'],

      // Operators
      [/@symbols/, {
        cases: {
          '@operators': 'operator',
          '@default': '',
        },
      }],
    ],

    whitespace: [
      [/[ \t\r\n]+/, ''],
      [/\/\/.*$/, 'comment'],
    ],

    string: [
      [/[^\\"]+/, 'string'],
      [/\\./, 'string'],
      [/"/, { token: 'string', next: '@pop' }],
    ],

    interpolatedString: [
      // `{` opens an interpolation hole; the dedicated state below tracks
      // nesting depth so holes containing `{ ... }` (record constructors,
      // set literals, nested interpolations) don't terminate early.
      [/\{/, { token: 'delimiter', next: '@interpolationHole' }],
      [/[^\\"{]+/, 'string'],
      [/\\./, 'string'],
      [/"/, { token: 'string', next: '@pop' }],
    ],

    // Inside a `{...}` hole of an interpolated string. Every nested `{`
    // pushes this state again and every `}` pops, so depth is tracked by
    // the Monarch state stack. Contents are tokenized conservatively —
    // identifiers/keywords/types, numbers, strings, and operators emit the
    // same theme-covered token names as @root; anything else is a
    // 'delimiter' so nothing leaks an unthemed token.
    interpolationHole: [
      [/\{/, { token: 'delimiter', next: '@interpolationHole' }],
      [/\}/, { token: 'delimiter', next: '@pop' }],
      [/\$"/, { token: 'string', next: '@interpolatedString' }],
      [/"/, { token: 'string', next: '@string' }],
      [/[a-zA-Z_]\w*/, {
        cases: {
          '@keywords': 'keyword',
          '@typeKeywords': 'type',
          '@constants': 'number',
          '@default': 'identifier',
        },
      }],
      [/0[xX][0-9a-fA-F]+/, 'number'],
      [/\d+\.(?!\.)\d*([eE][-+]?\d+)?/, 'number'],
      [/\.\d+([eE][-+]?\d+)?/, 'number'],
      [/\d+([eE][-+]?\d+)?/, 'number'],
      [/[ \t\r\n]+/, ''],
      [/@symbols/, {
        cases: {
          '@operators': 'operator',
          '@default': 'delimiter',
        },
      }],
      [/[()[\],;]/, 'delimiter'],
      [/./, 'delimiter'],
    ],
  },
};

/** Language configuration: comments, brackets, auto-closing pairs. */
export const qsharpLanguageConfiguration: monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: '//',
  },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
  ],
};

/**
 * Register Q# with Monaco. Idempotent — safe to call from every editor
 * mount; registration only happens the first time.
 */
export function registerQsharpLanguage(monacoInstance: Monaco): void {
  const alreadyRegistered = monacoInstance.languages
    .getLanguages()
    .some((lang) => lang.id === QSHARP_LANGUAGE_ID);
  if (alreadyRegistered) return;

  monacoInstance.languages.register({
    id: QSHARP_LANGUAGE_ID,
    extensions: ['.qs'],
    aliases: ['Q#', 'qsharp'],
  });
  monacoInstance.languages.setMonarchTokensProvider(QSHARP_LANGUAGE_ID, qsharpMonarchLanguage);
  monacoInstance.languages.setLanguageConfiguration(QSHARP_LANGUAGE_ID, qsharpLanguageConfiguration);
}
