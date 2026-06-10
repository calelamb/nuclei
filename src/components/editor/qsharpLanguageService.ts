/**
 * Q# language service integration — wires Microsoft's real QDK compiler
 * (the `qsharp-lang` npm package, compiled to WASM) into Monaco for live
 * compiler diagnostics, completions, hover docs, and signature help.
 *
 * Architecture:
 * - The WASM compiler runs in a web worker (qsharpLanguageServiceWorker.ts).
 *   The main thread compiles the WASM module once (`loadWasmModule`) and
 *   hands it to the worker through qsharp-lang's proxy protocol
 *   (`getLanguageServiceWorker`), so instantiation happens off the UI thread.
 * - Everything is lazy: `ensureQsharpLanguageService` dynamic-imports
 *   qsharp-lang (and the ~5 MB WASM asset) only once a Q# buffer is active,
 *   so Python-only sessions never pay the download.
 * - If package/WASM/worker init fails, we console.warn and resolve — the
 *   Monarch tokenizer (qsharpLanguage.ts) keeps providing syntax
 *   highlighting and the editor is never broken by the language service.
 * - Diagnostics markers use the 'qsharp-ls' owner so they coexist with the
 *   kernel's 'nuclei' markers set by QuantumEditor.
 *
 * The pure `map*` helpers and the `attach*`/`register*` wiring functions are
 * exported for unit testing without WASM or a real worker.
 */

import type * as monaco from 'monaco-editor';
import type { ILanguageService, IPosition, IRange, VSDiagnostic } from 'qsharp-lang';
import { QSHARP_LANGUAGE_ID } from './qsharpLanguage';

type Monaco = typeof monaco;

/**
 * Marker owner for language-service diagnostics. Distinct from the kernel's
 * 'nuclei' owner — Monaco tracks marker sets per owner, so the two never
 * clobber each other.
 */
export const QSHARP_LS_MARKER_OWNER = 'qsharp-ls';

/** Matches the repo-wide 300ms debounce culture (see kernel parse debounce). */
export const QSHARP_LS_UPDATE_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Language-service result shapes.
//
// qsharp-lang's package root re-exports IPosition/IRange/VSDiagnostic but not
// the completion/hover/signature shapes, and its exports map blocks deep
// imports — so those are declared structurally here (mirroring
// dist/lib/web/qsc_wasm.d.ts in qsharp-lang@1.29.1).
// ---------------------------------------------------------------------------

/** Completion item as returned by `ILanguageService.getCompletions`. */
export interface QsCompletionItem {
  label: string;
  kind:
    | 'function'
    | 'interface'
    | 'keyword'
    | 'module'
    | 'property'
    | 'variable'
    | 'typeParameter'
    | 'field'
    | 'class';
  sortText?: string;
  detail?: string;
  additionalTextEdits?: Array<{ range: IRange; newText: string }>;
}

/** Hover result as returned by `ILanguageService.getHover`. */
export interface QsHover {
  contents: string;
  span: IRange;
}

/** Signature help result as returned by `ILanguageService.getSignatureHelp`. */
export interface QsSignatureHelp {
  signatures: Array<{
    label: string;
    documentation: string;
    parameters: Array<{ label: [number, number]; documentation: string }>;
  }>;
  activeSignature: number;
  activeParameter: number;
}

/** The subset of `monaco.MarkerSeverity` the mappers need (mockable in tests). */
export type MarkerSeverityMap = Pick<
  typeof monaco.MarkerSeverity,
  'Error' | 'Warning' | 'Info' | 'Hint'
>;

/** The subset of `monaco.languages.CompletionItemKind` the mappers need. */
export type CompletionKindMap = Pick<
  typeof monaco.languages.CompletionItemKind,
  | 'Function'
  | 'Interface'
  | 'Keyword'
  | 'Module'
  | 'Property'
  | 'Variable'
  | 'TypeParameter'
  | 'Field'
  | 'Class'
>;

// ---------------------------------------------------------------------------
// Pure mapping helpers (unit-testable without WASM / Monaco).
//
// The QDK language service speaks LSP conventions: 0-based line/character
// positions (UTF-16 columns, same code-unit convention as Monaco). Monaco is
// 1-based on both axes.
// ---------------------------------------------------------------------------

/** Monaco (1-based) position → language-service (0-based) position. */
export function monacoPositionToLsPosition(position: {
  lineNumber: number;
  column: number;
}): IPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 };
}

/** Language-service (0-based) range → Monaco (1-based) range. */
export function lsRangeToMonacoRange(range: IRange): monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

/**
 * LS diagnostic severity → Monaco marker severity. Unknown severities map to
 * Error (matching the official playground) so new compiler severities are
 * never silently hidden. 'hint' is handled for forward compatibility — the
 * 1.29.x type union is error | warning | info, but newer service versions
 * also emit hint.
 */
export function mapDiagnosticSeverity(
  severity: string,
  severities: MarkerSeverityMap,
): monaco.MarkerSeverity {
  switch (severity) {
    case 'warning':
      return severities.Warning;
    case 'info':
      return severities.Info;
    case 'hint':
      return severities.Hint;
    case 'error':
    default:
      return severities.Error;
  }
}

/**
 * LS diagnostic → Monaco marker. Related-information spans are not mapped:
 * they usually point into the Q# standard library, which is not an open
 * editor document in Nuclei.
 */
export function mapDiagnosticToMarker(
  diag: VSDiagnostic,
  severities: MarkerSeverityMap,
): monaco.editor.IMarkerData {
  return {
    ...lsRangeToMonacoRange(diag.range),
    severity: mapDiagnosticSeverity(diag.severity, severities),
    message: diag.message,
    ...(diag.code !== undefined ? { code: diag.code } : {}),
  };
}

/**
 * LS completion kind → Monaco completion kind. Unknown kinds fall back to
 * Variable (a neutral icon) rather than dropping the item.
 */
export function mapCompletionKind(
  kind: string,
  kinds: CompletionKindMap,
): monaco.languages.CompletionItemKind {
  switch (kind) {
    case 'function':
      return kinds.Function;
    case 'interface':
      return kinds.Interface;
    case 'keyword':
      return kinds.Keyword;
    case 'module':
      return kinds.Module;
    case 'property':
      return kinds.Property;
    case 'typeParameter':
      return kinds.TypeParameter;
    case 'field':
      return kinds.Field;
    case 'class':
      return kinds.Class;
    case 'variable':
    default:
      return kinds.Variable;
  }
}

/** LS completion item → Monaco completion item (range supplied by caller). */
export function mapCompletionItem(
  item: QsCompletionItem,
  kinds: CompletionKindMap,
  range: monaco.IRange,
): monaco.languages.CompletionItem {
  return {
    label: item.label,
    kind: mapCompletionKind(item.kind, kinds),
    insertText: item.label,
    range,
    ...(item.sortText !== undefined ? { sortText: item.sortText } : {}),
    ...(item.detail !== undefined ? { detail: item.detail } : {}),
    ...(item.additionalTextEdits
      ? {
          additionalTextEdits: item.additionalTextEdits.map((edit) => ({
            range: lsRangeToMonacoRange(edit.range),
            text: edit.newText,
          })),
        }
      : {}),
  };
}

/** LS hover (markdown string + span) → Monaco hover. */
export function mapHover(hover: QsHover): monaco.languages.Hover {
  return {
    contents: [{ value: hover.contents }],
    range: lsRangeToMonacoRange(hover.span),
  };
}

/** LS signature help → Monaco signature help. */
export function mapSignatureHelp(
  signatureHelp: QsSignatureHelp,
): monaco.languages.SignatureHelp {
  return {
    activeSignature: signatureHelp.activeSignature,
    activeParameter: signatureHelp.activeParameter,
    signatures: signatureHelp.signatures.map((signature) => ({
      label: signature.label,
      documentation: { value: signature.documentation },
      parameters: signature.parameters.map((parameter) => ({
        label: parameter.label,
        documentation: { value: parameter.documentation },
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Monaco wiring. Exported so tests can drive them with fakes.
// ---------------------------------------------------------------------------

/**
 * Register completion / hover / signature-help providers for the `qsharp`
 * language id. Provider failures degrade to empty results — a language
 * service hiccup must never surface as an editor error.
 */
export function registerQsharpProviders(
  monacoApi: Monaco,
  languageService: ILanguageService,
): void {
  monacoApi.languages.registerCompletionItemProvider(QSHARP_LANGUAGE_ID, {
    // Mirrors the official playground / VS Code extension trigger set.
    triggerCharacters: ['.', '@'],
    provideCompletionItems: async (model, position) => {
      try {
        const completions = await languageService.getCompletions(
          model.uri.toString(),
          monacoPositionToLsPosition(position),
        );
        const word = model.getWordUntilPosition(position);
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: completions.items.map((item) =>
            mapCompletionItem(item, monacoApi.languages.CompletionItemKind, range),
          ),
        };
      } catch {
        return { suggestions: [] };
      }
    },
  });

  monacoApi.languages.registerHoverProvider(QSHARP_LANGUAGE_ID, {
    provideHover: async (model, position) => {
      try {
        const hover = await languageService.getHover(
          model.uri.toString(),
          monacoPositionToLsPosition(position),
        );
        return hover ? mapHover(hover) : null;
      } catch {
        return null;
      }
    },
  });

  monacoApi.languages.registerSignatureHelpProvider(QSHARP_LANGUAGE_ID, {
    signatureHelpTriggerCharacters: ['(', ','],
    provideSignatureHelp: async (model, position) => {
      try {
        const signatureHelp = await languageService.getSignatureHelp(
          model.uri.toString(),
          monacoPositionToLsPosition(position),
        );
        return signatureHelp
          ? { value: mapSignatureHelp(signatureHelp), dispose: () => {} }
          : null;
      } catch {
        return null;
      }
    },
  });
}

/**
 * Subscribe to the language service's `diagnostics` event and surface
 * compiler errors/warnings as Monaco markers under the 'qsharp-ls' owner.
 */
export function attachQsharpDiagnostics(
  monacoApi: Monaco,
  languageService: ILanguageService,
): void {
  languageService.addEventListener('diagnostics', (evt) => {
    const { uri, diagnostics } = evt.detail;
    const model = monacoApi.editor.getModel(monacoApi.Uri.parse(uri));
    if (!model || model.isDisposed()) return;
    monacoApi.editor.setModelMarkers(
      model,
      QSHARP_LS_MARKER_OWNER,
      diagnostics.map((diag) => mapDiagnosticToMarker(diag, monacoApi.MarkerSeverity)),
    );
  });
}

interface ModelSyncState {
  timer: ReturnType<typeof setTimeout> | null;
  subscription: monaco.IDisposable;
}

/**
 * Keep the language service's view of every Q# model in sync with Monaco:
 * - existing + newly created qsharp models are opened immediately;
 * - content changes are pushed after a 300ms debounce (not per keystroke);
 * - switching a model away from qsharp closes the document and clears the
 *   'qsharp-ls' markers; disposing a model closes the document.
 */
export function attachQsharpDocumentSync(
  monacoApi: Monaco,
  languageService: ILanguageService,
): void {
  const tracked = new Map<string, ModelSyncState>();

  const pushDocument = (model: monaco.editor.ITextModel): void => {
    if (model.isDisposed()) return;
    languageService
      .updateDocument(model.uri.toString(), model.getVersionId(), model.getValue())
      .catch(() => {
        // Worker hiccup — the next edit retries; diagnostics simply lag.
      });
  };

  const track = (model: monaco.editor.ITextModel): void => {
    const uri = model.uri.toString();
    if (model.getLanguageId() !== QSHARP_LANGUAGE_ID || tracked.has(uri)) return;
    const state: ModelSyncState = {
      timer: null,
      subscription: model.onDidChangeContent(() => {
        if (state.timer !== null) clearTimeout(state.timer);
        state.timer = setTimeout(() => {
          state.timer = null;
          pushDocument(model);
        }, QSHARP_LS_UPDATE_DEBOUNCE_MS);
      }),
    };
    tracked.set(uri, state);
    // Initial open is immediate so first diagnostics don't wait on an edit.
    pushDocument(model);
  };

  const untrack = (model: monaco.editor.ITextModel, clearMarkers: boolean): void => {
    const uri = model.uri.toString();
    const state = tracked.get(uri);
    if (!state) return;
    tracked.delete(uri);
    if (state.timer !== null) clearTimeout(state.timer);
    state.subscription.dispose();
    if (clearMarkers && !model.isDisposed()) {
      monacoApi.editor.setModelMarkers(model, QSHARP_LS_MARKER_OWNER, []);
    }
    languageService.closeDocument(uri).catch(() => {
      // Document already gone on the service side — nothing to do.
    });
  };

  monacoApi.editor.getModels().forEach(track);
  monacoApi.editor.onDidCreateModel(track);
  monacoApi.editor.onDidChangeModelLanguage(({ model }) => {
    if (model.getLanguageId() === QSHARP_LANGUAGE_ID) {
      track(model);
    } else {
      untrack(model, true);
    }
  });
  monacoApi.editor.onWillDisposeModel((model) => {
    // Markers die with the model; only the service-side document needs closing.
    untrack(model, false);
  });
}

// ---------------------------------------------------------------------------
// Lazy, idempotent bootstrap.
// ---------------------------------------------------------------------------

async function initQsharpLanguageService(monacoApi: Monaco): Promise<void> {
  // Package import first: if the chunk fails to load, we bail before
  // touching the (much larger) WASM asset.
  const qsharp = await import('qsharp-lang');

  // qsharp-lang's exports map doesn't expose lib/, so the WASM binary is
  // referenced by file path. Vite emits it as a hashed local asset (no CDN)
  // and `?url` hands back its URL without inlining the bytes.
  const { default: wasmUrl } = await import(
    '../../../node_modules/qsharp-lang/lib/web/qsc_wasm_bg.wasm?url'
  );
  await qsharp.loadWasmModule(wasmUrl);

  // Vite bundles this worker locally; the compiled WASM module is posted to
  // it via the proxy's `init` message (structured clone of WebAssembly.Module).
  const worker = new Worker(
    new URL('./qsharpLanguageServiceWorker.ts', import.meta.url),
    { type: 'module' },
  );
  const languageService = qsharp.getLanguageServiceWorker({
    postMessage: (msg: unknown) => worker.postMessage(msg),
    onMessage: (handler: (e: MessageEvent) => void) => {
      worker.onmessage = handler;
    },
    onError: (handler: (e: Event) => void) => {
      worker.onerror = handler;
    },
    terminate: () => worker.terminate(),
  });

  // Nuclei targets the simulator, so the unrestricted profile avoids
  // spurious "not supported by the target profile" diagnostics.
  await languageService.updateConfiguration({
    packageType: 'exe',
    targetProfile: 'unrestricted',
  });

  registerQsharpProviders(monacoApi, languageService);
  attachQsharpDiagnostics(monacoApi, languageService);
  attachQsharpDocumentSync(monacoApi, languageService);
}

let ensurePromise: Promise<void> | null = null;

/**
 * Start the QDK language service exactly once. Lazy (call it when a Q#
 * buffer becomes active, not at app startup), idempotent (every call after
 * the first returns the same promise), and non-throwing: on failure it
 * warns and resolves, leaving Monarch-only highlighting in place.
 */
export function ensureQsharpLanguageService(monacoApi: Monaco): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = initQsharpLanguageService(monacoApi).catch((err: unknown) => {
      console.warn(
        '[qsharp-ls] Q# language service unavailable — falling back to syntax highlighting only.',
        err,
      );
    });
  }
  return ensurePromise;
}
