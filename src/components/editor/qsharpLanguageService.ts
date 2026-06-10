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

/**
 * Matches the repo-wide 300ms debounce culture (see kernel parse debounce).
 *
 * Known tradeoff: completions/hover may run against a service-side document
 * that is up to 300ms stale (the provider queries by URI while the latest
 * edit is still sitting in the debounce window). The official QDK VS Code
 * extension makes the same tradeoff — do not "fix" this by zero-debouncing,
 * which would push a full document to the worker on every keystroke.
 */
export const QSHARP_LS_UPDATE_DEBOUNCE_MS = 300;

/**
 * Upper bound on language-service startup (package chunk + ~5 MB WASM fetch +
 * worker handshake). Without it, a stalled asset fetch leaves the init
 * promise pending forever and the failure is never logged.
 */
export const QSHARP_LS_INIT_TIMEOUT_MS = 15_000;

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
 *
 * Returns the Monaco registration disposables so the bootstrap can unregister
 * the providers on teardown (Monaco outlives this module under Vite HMR).
 */
export function registerQsharpProviders(
  monacoApi: Monaco,
  languageService: ILanguageService,
): monaco.IDisposable[] {
  const completionDisposable = monacoApi.languages.registerCompletionItemProvider(QSHARP_LANGUAGE_ID, {
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

  const hoverDisposable = monacoApi.languages.registerHoverProvider(QSHARP_LANGUAGE_ID, {
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

  const signatureDisposable = monacoApi.languages.registerSignatureHelpProvider(
    QSHARP_LANGUAGE_ID,
    {
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
    },
  );

  return [completionDisposable, hoverDisposable, signatureDisposable];
}

/**
 * Subscribe to the language service's `diagnostics` event and surface
 * compiler errors/warnings as Monaco markers under the 'qsharp-ls' owner.
 *
 * Returns a disposable that detaches the listener (via the service's
 * `removeEventListener`) so a torn-down instance stops writing markers.
 */
export function attachQsharpDiagnostics(
  monacoApi: Monaco,
  languageService: ILanguageService,
): monaco.IDisposable {
  const onDiagnostics = (evt: {
    detail: { uri: string; diagnostics: VSDiagnostic[] };
  }): void => {
    const { uri, diagnostics } = evt.detail;
    const model = monacoApi.editor.getModel(monacoApi.Uri.parse(uri));
    if (!model || model.isDisposed()) return;
    monacoApi.editor.setModelMarkers(
      model,
      QSHARP_LS_MARKER_OWNER,
      diagnostics.map((diag) => mapDiagnosticToMarker(diag, monacoApi.MarkerSeverity)),
    );
  };
  languageService.addEventListener('diagnostics', onDiagnostics);
  return {
    dispose: () => languageService.removeEventListener('diagnostics', onDiagnostics),
  };
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
 *
 * Returns a disposable that detaches the three global Monaco listeners and
 * drops every per-model subscription and pending debounce timer.
 */
export function attachQsharpDocumentSync(
  monacoApi: Monaco,
  languageService: ILanguageService,
): monaco.IDisposable {
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
  const globalListeners: monaco.IDisposable[] = [
    monacoApi.editor.onDidCreateModel(track),
    monacoApi.editor.onDidChangeModelLanguage(({ model }) => {
      if (model.getLanguageId() === QSHARP_LANGUAGE_ID) {
        track(model);
      } else {
        untrack(model, true);
      }
    }),
    monacoApi.editor.onWillDisposeModel((model) => {
      // Markers die with the model; only the service-side document needs closing.
      untrack(model, false);
    }),
  ];

  return {
    dispose: () => {
      globalListeners.forEach((listener) => listener.dispose());
      // No closeDocument here: teardown happens because the worker (and with
      // it the whole service) is going away, so there is no service to notify.
      tracked.forEach((state) => {
        if (state.timer !== null) clearTimeout(state.timer);
        state.subscription.dispose();
      });
      tracked.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Lazy, idempotent bootstrap.
// ---------------------------------------------------------------------------

/** Everything a live language-service instance owns, for teardown. */
interface QsharpLsHandle {
  /** Provider registrations, diagnostics listener, document-sync wiring. */
  disposables: monaco.IDisposable[];
  worker: Worker;
}

async function initQsharpLanguageService(monacoApi: Monaco): Promise<QsharpLsHandle> {
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
  const disposables: monaco.IDisposable[] = [];
  try {
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

    disposables.push(...registerQsharpProviders(monacoApi, languageService));
    disposables.push(attachQsharpDiagnostics(monacoApi, languageService));
    disposables.push(attachQsharpDocumentSync(monacoApi, languageService));
    return { disposables, worker };
  } catch (err) {
    // Don't leak a half-initialized instance: whatever got wired before the
    // failure is unwound and the worker is terminated.
    disposables.forEach((disposable) => disposable.dispose());
    worker.terminate();
    throw err;
  }
}

/**
 * Reject if `promise` does not settle within `timeoutMs`. The timer is
 * cleared once the race settles so a fast init doesn't leave a stray timeout
 * alive. Exported for unit testing.
 */
export function raceWithInitTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `Q# language service init timed out after ${timeoutMs}ms — ` +
            'the qsharp-lang chunk, WASM asset, or worker handshake stalled.',
        ),
      );
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let ensurePromise: Promise<void> | null = null;
let activeHandle: QsharpLsHandle | null = null;
/** Bumped on dispose so an in-flight init knows its result is unwanted. */
let generation = 0;

function disposeHandle(handle: QsharpLsHandle): void {
  handle.disposables.forEach((disposable) => disposable.dispose());
  handle.worker.terminate();
}

/**
 * Tear down the running language-service instance: unregister the Monaco
 * providers, detach the diagnostics + document-sync listeners (clearing any
 * pending debounce timers), terminate the worker, and reset the idempotency
 * latch so a later `ensureQsharpLanguageService` call starts fresh.
 */
export function disposeQsharpLanguageService(): void {
  generation += 1;
  ensurePromise = null;
  if (activeHandle) {
    disposeHandle(activeHandle);
    activeHandle = null;
  }
}

/**
 * Start the QDK language service exactly once. Lazy (call it when a Q#
 * buffer becomes active, not at app startup), idempotent (every call after
 * the first returns the same promise), and non-throwing: on failure —
 * including an init that hangs past `timeoutMs` — it warns and resolves,
 * leaving Monarch-only highlighting in place.
 */
export function ensureQsharpLanguageService(
  monacoApi: Monaco,
  timeoutMs: number = QSHARP_LS_INIT_TIMEOUT_MS,
): Promise<void> {
  if (!ensurePromise) {
    const startGeneration = generation;
    const init = initQsharpLanguageService(monacoApi).then((handle) => {
      if (startGeneration !== generation) {
        // Disposed (HMR teardown) while init was in flight — the surviving
        // Monaco instance must not keep this orphaned registration.
        disposeHandle(handle);
        return;
      }
      activeHandle = handle;
    });
    ensurePromise = raceWithInitTimeout(init, timeoutMs).catch((err: unknown) => {
      console.warn(
        '[qsharp-ls] Q# language service unavailable — falling back to syntax highlighting only.',
        err,
      );
    });
  }
  return ensurePromise;
}

// Vite HMR re-evaluates this module while the Monaco instance (and its
// registered providers) survives — without teardown, every HMR cycle of this
// chunk would stack a duplicate set of providers and spawn another worker.
// `import.meta.hot` is undefined in production builds, so this is dev-only.
import.meta.hot?.dispose(() => {
  disposeQsharpLanguageService();
});
