import type * as monaco from 'monaco-editor';

type Monaco = typeof monaco;

/** Monaco language id for Stim. Shared by the editor and file-extension map. */
export const STIM_LANGUAGE_ID = 'stim';

/**
 * Clifford gates, resets, and measurements — the operational instructions.
 * Tokenized as `keyword`. Stim instruction names are case-insensitive on
 * parse but canonically uppercase; the tokenizer matches case-insensitively.
 */
export const STIM_GATES = [
  // Single-qubit Cliffords
  'I', 'X', 'Y', 'Z', 'H', 'S', 'S_DAG', 'SQRT_X', 'SQRT_X_DAG',
  'SQRT_Y', 'SQRT_Y_DAG', 'SQRT_Z', 'SQRT_Z_DAG',
  'H_XY', 'H_XZ', 'H_YZ', 'C_XYZ', 'C_ZYX',
  // Two-qubit gates
  'CNOT', 'CX', 'CY', 'CZ', 'XCX', 'XCY', 'XCZ', 'YCX', 'YCY', 'YCZ',
  'ZCX', 'ZCY', 'ZCZ', 'SWAP', 'ISWAP', 'ISWAP_DAG', 'CXSWAP', 'SWAPCX',
  'SQRT_XX', 'SQRT_XX_DAG', 'SQRT_YY', 'SQRT_YY_DAG', 'SQRT_ZZ', 'SQRT_ZZ_DAG',
  // Measurement + reset
  'M', 'MX', 'MY', 'MZ', 'MR', 'MRX', 'MRY', 'MRZ', 'R', 'RX', 'RY', 'RZ',
  'MPP', 'MPAD', 'MXX', 'MYY', 'MZZ',
  // Control flow
  'REPEAT',
];

/**
 * Noise channels — highlighted distinctly (`type` token) so a noisy
 * circuit reads at a glance. PRD 10 D2's "noise ops highlighted
 * distinctly" requirement.
 */
export const STIM_NOISE_OPS = [
  'X_ERROR', 'Y_ERROR', 'Z_ERROR',
  'DEPOLARIZE1', 'DEPOLARIZE2',
  'PAULI_CHANNEL_1', 'PAULI_CHANNEL_2',
  'CORRELATED_ERROR', 'E', 'ELSE_CORRELATED_ERROR',
  'HERALDED_ERASE', 'HERALDED_PAULI_CHANNEL_1',
  'II_ERROR', 'I_ERROR',
];

/**
 * Annotations — detectors, observables, coordinates, and the moment
 * separator. Tokenized as `string` so the marker track stands apart from
 * both gates and noise in every Nuclei theme.
 */
export const STIM_ANNOTATIONS = [
  'DETECTOR', 'OBSERVABLE_INCLUDE', 'QUBIT_COORDS', 'SHIFT_COORDS', 'TICK',
];

/**
 * Monarch tokenizer for Stim circuit files. Emits only token names the
 * Nuclei themes cover (`keyword`, `type`, `string`, `number`, `comment`)
 * plus Monaco defaults. Instruction-name matching is case-insensitive,
 * like stim's own parser.
 */
export const stimMonarchLanguage: monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.stim',
  ignoreCase: true,

  gates: STIM_GATES,
  noiseOps: STIM_NOISE_OPS,
  annotations: STIM_ANNOTATIONS,

  tokenizer: {
    root: [
      // Comments run to end of line.
      [/#.*$/, 'comment'],

      // rec[-1] / sweep[2] measurement-record and sweep-bit targets.
      [/\b(rec|sweep)\b(?=\[)/, 'number'],

      // Instruction names: first word-ish token on a line. One rule with
      // cases keeps precedence: noise > annotation > gate > unknown.
      [/[A-Za-z_][A-Za-z0-9_]*/, {
        cases: {
          '@noiseOps': 'type',
          '@annotations': 'string',
          '@gates': 'keyword',
          '@default': 'identifier',
        },
      }],

      // Numbers: probabilities/coordinates (float, scientific) and
      // qubit/target indices, including the ! inverted-record prefix.
      [/-?\d+(\.\d+)?([eE][-+]?\d+)?/, 'number'],
      [/!/, 'operator'],
      [/[[\](){},*]/, 'delimiter'],
      [/[ \t\r\n]+/, ''],
      [/./, 'delimiter'],
    ],
  },
};

/** Language configuration: `#` comments, bracket pairs for REPEAT blocks. */
export const stimLanguageConfiguration: monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: '#',
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
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
  ],
};

/**
 * Register Stim with Monaco. Idempotent — safe to call from every editor
 * mount; registration only happens the first time.
 */
export function registerStimLanguage(monacoInstance: Monaco): void {
  const alreadyRegistered = monacoInstance.languages
    .getLanguages()
    .some((lang) => lang.id === STIM_LANGUAGE_ID);
  if (alreadyRegistered) return;

  monacoInstance.languages.register({
    id: STIM_LANGUAGE_ID,
    extensions: ['.stim'],
    aliases: ['Stim', 'stim'],
  });
  monacoInstance.languages.setMonarchTokensProvider(STIM_LANGUAGE_ID, stimMonarchLanguage);
  monacoInstance.languages.setLanguageConfiguration(STIM_LANGUAGE_ID, stimLanguageConfiguration);
}
