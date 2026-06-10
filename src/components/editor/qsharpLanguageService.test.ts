/**
 * Unit tests for the Q# language service integration.
 *
 * The WASM compiler and web worker cannot run under vitest/jsdom, so these
 * tests cover the pure mapping helpers, the Monaco wiring (with plain-object
 * fakes), the lifecycle disposables (provider unregistration, listener
 * detach, debounce-timer cleanup), the init timeout race, and the
 * ensureQsharpLanguageService failure guard (qsharp-lang is mocked to fail
 * on import). Real-WASM behavior is covered by the manual checklist in the
 * Phase E report.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type * as monaco from 'monaco-editor';
import type { ILanguageService, VSDiagnostic } from 'qsharp-lang';
import {
  QSHARP_LS_MARKER_OWNER,
  QSHARP_LS_UPDATE_DEBOUNCE_MS,
  monacoPositionToLsPosition,
  lsRangeToMonacoRange,
  mapDiagnosticSeverity,
  mapDiagnosticToMarker,
  mapCompletionKind,
  mapCompletionItem,
  mapHover,
  mapSignatureHelp,
  registerQsharpProviders,
  attachQsharpDiagnostics,
  attachQsharpDocumentSync,
  raceWithInitTimeout,
  ensureQsharpLanguageService,
  disposeQsharpLanguageService,
} from './qsharpLanguageService';

// Simulate the dynamic import of qsharp-lang failing (e.g. WASM chunk
// blocked / package broken) — ensureQsharpLanguageService must warn and
// resolve, never reject.
vi.mock('qsharp-lang', () => {
  throw new Error('simulated qsharp-lang import failure');
});

type Monaco = typeof monaco;

// Numeric values mirror the real Monaco enums.
const MARKER_SEVERITY = { Error: 8, Warning: 4, Info: 2, Hint: 1 } as const;
const COMPLETION_KIND = {
  Function: 1,
  Interface: 7,
  Keyword: 17,
  Module: 8,
  Property: 9,
  Variable: 4,
  TypeParameter: 24,
  Field: 3,
  Class: 5,
} as const;

const LS_RANGE = {
  start: { line: 2, character: 4 },
  end: { line: 2, character: 9 },
};

const MONACO_RANGE = {
  startLineNumber: 3,
  startColumn: 5,
  endLineNumber: 3,
  endColumn: 10,
};

describe('position and range mapping', () => {
  it('converts Monaco 1-based positions to LS 0-based positions', () => {
    expect(monacoPositionToLsPosition({ lineNumber: 3, column: 7 })).toEqual({
      line: 2,
      character: 6,
    });
    expect(monacoPositionToLsPosition({ lineNumber: 1, column: 1 })).toEqual({
      line: 0,
      character: 0,
    });
  });

  it('converts LS 0-based ranges to Monaco 1-based ranges', () => {
    expect(lsRangeToMonacoRange(LS_RANGE)).toEqual(MONACO_RANGE);
  });
});

describe('mapDiagnosticSeverity', () => {
  it('maps error, warning, info, and hint', () => {
    expect(mapDiagnosticSeverity('error', MARKER_SEVERITY)).toBe(8);
    expect(mapDiagnosticSeverity('warning', MARKER_SEVERITY)).toBe(4);
    expect(mapDiagnosticSeverity('info', MARKER_SEVERITY)).toBe(2);
    expect(mapDiagnosticSeverity('hint', MARKER_SEVERITY)).toBe(1);
  });

  it('defaults unknown severities to Error so nothing is hidden', () => {
    expect(mapDiagnosticSeverity('mystery', MARKER_SEVERITY)).toBe(8);
  });
});

describe('mapDiagnosticToMarker', () => {
  it('maps a compiler error span to a 1-based Monaco marker', () => {
    const diag: VSDiagnostic = {
      range: LS_RANGE,
      message: 'name error: `Hadamard` not found',
      severity: 'error',
      code: 'Qsc.Resolve.NotFound',
    };
    expect(mapDiagnosticToMarker(diag, MARKER_SEVERITY)).toEqual({
      ...MONACO_RANGE,
      severity: 8,
      message: 'name error: `Hadamard` not found',
      code: 'Qsc.Resolve.NotFound',
    });
  });

  it('maps warnings and omits code when absent', () => {
    const diag: VSDiagnostic = {
      range: LS_RANGE,
      message: 'unused variable',
      severity: 'warning',
    };
    const marker = mapDiagnosticToMarker(diag, MARKER_SEVERITY);
    expect(marker.severity).toBe(4);
    expect('code' in marker).toBe(false);
  });
});

describe('mapCompletionKind', () => {
  it('maps every LS kind to the corresponding Monaco kind', () => {
    expect(mapCompletionKind('function', COMPLETION_KIND)).toBe(1);
    expect(mapCompletionKind('interface', COMPLETION_KIND)).toBe(7);
    expect(mapCompletionKind('keyword', COMPLETION_KIND)).toBe(17);
    expect(mapCompletionKind('module', COMPLETION_KIND)).toBe(8);
    expect(mapCompletionKind('property', COMPLETION_KIND)).toBe(9);
    expect(mapCompletionKind('variable', COMPLETION_KIND)).toBe(4);
    expect(mapCompletionKind('typeParameter', COMPLETION_KIND)).toBe(24);
    expect(mapCompletionKind('field', COMPLETION_KIND)).toBe(3);
    expect(mapCompletionKind('class', COMPLETION_KIND)).toBe(5);
  });

  it('falls back to Variable for unknown kinds', () => {
    expect(mapCompletionKind('somethingNew', COMPLETION_KIND)).toBe(4);
  });
});

describe('mapCompletionItem', () => {
  it('maps label, kind, optional fields, and additional text edits', () => {
    const item = {
      label: 'CNOT',
      kind: 'function' as const,
      sortText: '0100CNOT',
      detail: 'operation CNOT(control : Qubit, target : Qubit) : Unit',
      additionalTextEdits: [{ range: LS_RANGE, newText: 'import Std.Intrinsic.*;\n' }],
    };
    expect(mapCompletionItem(item, COMPLETION_KIND, MONACO_RANGE)).toEqual({
      label: 'CNOT',
      kind: 1,
      insertText: 'CNOT',
      range: MONACO_RANGE,
      sortText: '0100CNOT',
      detail: 'operation CNOT(control : Qubit, target : Qubit) : Unit',
      additionalTextEdits: [{ range: MONACO_RANGE, text: 'import Std.Intrinsic.*;\n' }],
    });
  });

  it('omits optional fields that the LS did not provide', () => {
    const mapped = mapCompletionItem(
      { label: 'H', kind: 'function' },
      COMPLETION_KIND,
      MONACO_RANGE,
    );
    expect(mapped).toEqual({
      label: 'H',
      kind: 1,
      insertText: 'H',
      range: MONACO_RANGE,
    });
  });
});

describe('mapHover', () => {
  it('wraps the markdown contents and converts the span', () => {
    expect(mapHover({ contents: '```qsharp\noperation H...\n```', span: LS_RANGE })).toEqual({
      contents: [{ value: '```qsharp\noperation H...\n```' }],
      range: MONACO_RANGE,
    });
  });
});

describe('mapSignatureHelp', () => {
  it('maps signatures, parameters, and active indices', () => {
    const mapped = mapSignatureHelp({
      activeSignature: 0,
      activeParameter: 1,
      signatures: [
        {
          label: 'operation CNOT(control : Qubit, target : Qubit) : Unit',
          documentation: 'Applies CNOT.',
          parameters: [
            { label: [15, 30], documentation: 'control qubit' },
            { label: [32, 46], documentation: 'target qubit' },
          ],
        },
      ],
    });
    expect(mapped).toEqual({
      activeSignature: 0,
      activeParameter: 1,
      signatures: [
        {
          label: 'operation CNOT(control : Qubit, target : Qubit) : Unit',
          documentation: { value: 'Applies CNOT.' },
          parameters: [
            { label: [15, 30], documentation: { value: 'control qubit' } },
            { label: [32, 46], documentation: { value: 'target qubit' } },
          ],
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// Fakes for the Monaco wiring tests.
// ---------------------------------------------------------------------------

interface FakeModel {
  uri: { toString(): string };
  getLanguageId(): string;
  getVersionId(): number;
  getValue(): string;
  isDisposed(): boolean;
  getWordUntilPosition(position: { lineNumber: number; column: number }): {
    word: string;
    startColumn: number;
    endColumn: number;
  };
  onDidChangeContent(listener: () => void): { dispose(): void };
  // test helpers
  type(next: string): void;
  setLanguage(lang: string): void;
  markDisposed(): void;
}

function createFakeModel(uri: string, language: string): FakeModel {
  const listeners: Array<() => void> = [];
  let currentLanguage = language;
  let disposed = false;
  let version = 1;
  let value = 'operation Main() : Unit {}';
  return {
    uri: { toString: () => uri },
    getLanguageId: () => currentLanguage,
    getVersionId: () => version,
    getValue: () => value,
    isDisposed: () => disposed,
    getWordUntilPosition: () => ({ word: 'CN', startColumn: 5, endColumn: 7 }),
    onDidChangeContent: (listener: () => void) => {
      listeners.push(listener);
      return {
        dispose: () => {
          const index = listeners.indexOf(listener);
          if (index !== -1) listeners.splice(index, 1);
        },
      };
    },
    type: (next: string) => {
      value = next;
      version += 1;
      listeners.forEach((listener) => listener());
    },
    setLanguage: (lang: string) => {
      currentLanguage = lang;
    },
    markDisposed: () => {
      disposed = true;
    },
  };
}

function createFakeMonaco(models: FakeModel[]) {
  const createListeners: Array<(m: FakeModel) => void> = [];
  const languageListeners: Array<(e: { model: FakeModel }) => void> = [];
  const disposeListeners: Array<(m: FakeModel) => void> = [];
  const setModelMarkers = vi.fn();
  const completionProviders: unknown[] = [];
  const hoverProviders: unknown[] = [];
  const signatureProviders: unknown[] = [];
  // Records which registrations/listeners have been disposed, in order.
  const disposedTags: string[] = [];

  const api = {
    Uri: { parse: (s: string) => ({ toString: () => s }) },
    MarkerSeverity: MARKER_SEVERITY,
    editor: {
      getModels: () => models,
      getModel: (uri: { toString(): string }) =>
        models.find((m) => m.uri.toString() === uri.toString()) ?? null,
      setModelMarkers,
      onDidCreateModel: (listener: (m: FakeModel) => void) => {
        createListeners.push(listener);
        return { dispose: () => disposedTags.push('onDidCreateModel') };
      },
      onDidChangeModelLanguage: (listener: (e: { model: FakeModel }) => void) => {
        languageListeners.push(listener);
        return { dispose: () => disposedTags.push('onDidChangeModelLanguage') };
      },
      onWillDisposeModel: (listener: (m: FakeModel) => void) => {
        disposeListeners.push(listener);
        return { dispose: () => disposedTags.push('onWillDisposeModel') };
      },
    },
    languages: {
      CompletionItemKind: COMPLETION_KIND,
      registerCompletionItemProvider: vi.fn((_id: string, provider: unknown) => {
        completionProviders.push(provider);
        return { dispose: () => disposedTags.push('completion') };
      }),
      registerHoverProvider: vi.fn((_id: string, provider: unknown) => {
        hoverProviders.push(provider);
        return { dispose: () => disposedTags.push('hover') };
      }),
      registerSignatureHelpProvider: vi.fn((_id: string, provider: unknown) => {
        signatureProviders.push(provider);
        return { dispose: () => disposedTags.push('signatureHelp') };
      }),
    },
  };

  return {
    api: api as unknown as Monaco,
    setModelMarkers,
    completionProviders,
    hoverProviders,
    disposedTags,
    fireCreate: (m: FakeModel) => createListeners.forEach((l) => l(m)),
    fireLanguageChange: (m: FakeModel) => languageListeners.forEach((l) => l({ model: m })),
    fireWillDispose: (m: FakeModel) => disposeListeners.forEach((l) => l(m)),
  };
}

function createFakeLanguageService() {
  const diagnosticsListeners: Array<(evt: unknown) => void> = [];
  const ls = {
    updateDocument: vi.fn(() => Promise.resolve()),
    closeDocument: vi.fn(() => Promise.resolve()),
    getCompletions: vi.fn(() => Promise.resolve({ items: [] })),
    getHover: vi.fn(() => Promise.resolve(undefined)),
    getSignatureHelp: vi.fn(() => Promise.resolve(undefined)),
    addEventListener: vi.fn((_type: string, listener: (evt: unknown) => void) => {
      diagnosticsListeners.push(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: (evt: unknown) => void) => {
      const index = diagnosticsListeners.indexOf(listener);
      if (index !== -1) diagnosticsListeners.splice(index, 1);
    }),
  };
  return {
    ls: ls as unknown as ILanguageService,
    mocks: ls,
    fireDiagnostics: (detail: unknown) =>
      diagnosticsListeners.forEach((l) => l({ type: 'diagnostics', detail })),
  };
}

describe('attachQsharpDiagnostics', () => {
  it('sets markers under the qsharp-ls owner for the matching model', () => {
    const model = createFakeModel('inmemory://model/1', 'qsharp');
    const fake = createFakeMonaco([model]);
    const { ls, fireDiagnostics } = createFakeLanguageService();

    attachQsharpDiagnostics(fake.api, ls);
    fireDiagnostics({
      uri: 'inmemory://model/1',
      version: 1,
      diagnostics: [
        { range: LS_RANGE, message: 'syntax error', severity: 'error' },
      ],
    });

    expect(fake.setModelMarkers).toHaveBeenCalledTimes(1);
    const [markedModel, owner, markers] = fake.setModelMarkers.mock.calls[0];
    expect(markedModel).toBe(model);
    expect(owner).toBe(QSHARP_LS_MARKER_OWNER);
    expect(markers).toEqual([
      { ...MONACO_RANGE, severity: 8, message: 'syntax error' },
    ]);
  });

  it('ignores diagnostics for unknown or disposed models', () => {
    const model = createFakeModel('inmemory://model/1', 'qsharp');
    const fake = createFakeMonaco([model]);
    const { ls, fireDiagnostics } = createFakeLanguageService();

    attachQsharpDiagnostics(fake.api, ls);
    fireDiagnostics({ uri: 'inmemory://model/999', version: 1, diagnostics: [] });
    model.markDisposed();
    fireDiagnostics({ uri: 'inmemory://model/1', version: 1, diagnostics: [] });

    expect(fake.setModelMarkers).not.toHaveBeenCalled();
  });

  it('clears markers when a live tracked model reports zero diagnostics', () => {
    const model = createFakeModel('inmemory://model/1', 'qsharp');
    const fake = createFakeMonaco([model]);
    const { ls, fireDiagnostics } = createFakeLanguageService();

    attachQsharpDiagnostics(fake.api, ls);
    fireDiagnostics({
      uri: 'inmemory://model/1',
      version: 1,
      diagnostics: [{ range: LS_RANGE, message: 'syntax error', severity: 'error' }],
    });
    // The fix compiles clean — an empty diagnostics list must clear markers.
    fireDiagnostics({ uri: 'inmemory://model/1', version: 2, diagnostics: [] });

    expect(fake.setModelMarkers).toHaveBeenCalledTimes(2);
    expect(fake.setModelMarkers).toHaveBeenLastCalledWith(
      model,
      QSHARP_LS_MARKER_OWNER,
      [],
    );
  });

  it('dispose detaches the listener via removeEventListener', () => {
    const model = createFakeModel('inmemory://model/1', 'qsharp');
    const fake = createFakeMonaco([model]);
    const { ls, mocks, fireDiagnostics } = createFakeLanguageService();

    const disposable = attachQsharpDiagnostics(fake.api, ls);
    disposable.dispose();

    expect(mocks.removeEventListener).toHaveBeenCalledTimes(1);
    expect(mocks.removeEventListener.mock.calls[0][0]).toBe('diagnostics');
    // Must be the identical function reference, or removal silently no-ops.
    expect(mocks.removeEventListener.mock.calls[0][1]).toBe(
      mocks.addEventListener.mock.calls[0][1],
    );

    fireDiagnostics({
      uri: 'inmemory://model/1',
      version: 1,
      diagnostics: [{ range: LS_RANGE, message: 'syntax error', severity: 'error' }],
    });
    expect(fake.setModelMarkers).not.toHaveBeenCalled();
  });
});

describe('attachQsharpDocumentSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens existing qsharp models immediately and ignores other languages', () => {
    const qsModel = createFakeModel('inmemory://model/1', 'qsharp');
    const pyModel = createFakeModel('inmemory://model/2', 'python');
    const fake = createFakeMonaco([qsModel, pyModel]);
    const { ls, mocks } = createFakeLanguageService();

    attachQsharpDocumentSync(fake.api, ls);

    expect(mocks.updateDocument).toHaveBeenCalledTimes(1);
    expect(mocks.updateDocument).toHaveBeenCalledWith(
      'inmemory://model/1',
      1,
      'operation Main() : Unit {}',
    );
  });

  it('debounces content changes at 300ms and sends only the latest text', () => {
    const model = createFakeModel('inmemory://model/1', 'qsharp');
    const fake = createFakeMonaco([model]);
    const { ls, mocks } = createFakeLanguageService();

    attachQsharpDocumentSync(fake.api, ls);
    mocks.updateDocument.mockClear();

    model.type('operation Main() : Unit { H');
    model.type('operation Main() : Unit { H(');
    model.type('operation Main() : Unit { H(q); }');
    expect(mocks.updateDocument).not.toHaveBeenCalled();

    vi.advanceTimersByTime(QSHARP_LS_UPDATE_DEBOUNCE_MS - 1);
    expect(mocks.updateDocument).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(mocks.updateDocument).toHaveBeenCalledTimes(1);
    expect(mocks.updateDocument).toHaveBeenCalledWith(
      'inmemory://model/1',
      4,
      'operation Main() : Unit { H(q); }',
    );
  });

  it('tracks models created later and ones switched to qsharp', () => {
    const fake = createFakeMonaco([]);
    const { ls, mocks } = createFakeLanguageService();
    attachQsharpDocumentSync(fake.api, ls);

    const created = createFakeModel('inmemory://model/3', 'qsharp');
    fake.fireCreate(created);
    expect(mocks.updateDocument).toHaveBeenCalledWith(
      'inmemory://model/3',
      1,
      'operation Main() : Unit {}',
    );

    const switched = createFakeModel('inmemory://model/4', 'python');
    fake.fireCreate(switched);
    switched.setLanguage('qsharp');
    fake.fireLanguageChange(switched);
    expect(mocks.updateDocument).toHaveBeenCalledWith(
      'inmemory://model/4',
      1,
      'operation Main() : Unit {}',
    );
  });

  it('closes the document and clears markers when switching away from qsharp', () => {
    const model = createFakeModel('inmemory://model/1', 'qsharp');
    const fake = createFakeMonaco([model]);
    const { ls, mocks } = createFakeLanguageService();

    attachQsharpDocumentSync(fake.api, ls);
    model.setLanguage('python');
    fake.fireLanguageChange(model);

    expect(mocks.closeDocument).toHaveBeenCalledWith('inmemory://model/1');
    expect(fake.setModelMarkers).toHaveBeenCalledWith(model, QSHARP_LS_MARKER_OWNER, []);

    // A pending debounce must not fire after untracking.
    model.type('let x = 1;');
    vi.advanceTimersByTime(QSHARP_LS_UPDATE_DEBOUNCE_MS * 2);
    expect(mocks.updateDocument).toHaveBeenCalledTimes(1); // initial open only
  });

  it('closes the document on model dispose without touching markers', () => {
    const model = createFakeModel('inmemory://model/1', 'qsharp');
    const fake = createFakeMonaco([model]);
    const { ls, mocks } = createFakeLanguageService();

    attachQsharpDocumentSync(fake.api, ls);
    fake.fireWillDispose(model);

    expect(mocks.closeDocument).toHaveBeenCalledWith('inmemory://model/1');
    expect(fake.setModelMarkers).not.toHaveBeenCalled();
  });

  it('dispose drops global listeners, model subscriptions, and pending timers', () => {
    const model = createFakeModel('inmemory://model/1', 'qsharp');
    const fake = createFakeMonaco([model]);
    const { ls, mocks } = createFakeLanguageService();

    const disposable = attachQsharpDocumentSync(fake.api, ls);
    mocks.updateDocument.mockClear();

    // Leave a debounce timer pending, then tear down.
    model.type('operation Main() : Unit { H(q); }');
    disposable.dispose();
    vi.advanceTimersByTime(QSHARP_LS_UPDATE_DEBOUNCE_MS * 2);
    expect(mocks.updateDocument).not.toHaveBeenCalled();

    // The per-model content subscription is gone — later edits never sync.
    model.type('operation Main() : Unit {}');
    vi.advanceTimersByTime(QSHARP_LS_UPDATE_DEBOUNCE_MS * 2);
    expect(mocks.updateDocument).not.toHaveBeenCalled();

    // All three global Monaco listeners were disposed.
    expect(fake.disposedTags).toEqual(
      expect.arrayContaining([
        'onDidCreateModel',
        'onDidChangeModelLanguage',
        'onWillDisposeModel',
      ]),
    );
  });
});

describe('registerQsharpProviders', () => {
  it('maps LS completions into Monaco suggestions with the word range', async () => {
    const model = createFakeModel('inmemory://model/1', 'qsharp');
    const fake = createFakeMonaco([model]);
    const { ls, mocks } = createFakeLanguageService();
    mocks.getCompletions.mockResolvedValue({
      items: [{ label: 'CNOT', kind: 'function' }],
    } as never);

    registerQsharpProviders(fake.api, ls);
    const provider = fake.completionProviders[0] as {
      provideCompletionItems(model: unknown, position: unknown): Promise<{
        suggestions: monaco.languages.CompletionItem[];
      }>;
    };
    const result = await provider.provideCompletionItems(model, {
      lineNumber: 1,
      column: 7,
    });

    expect(mocks.getCompletions).toHaveBeenCalledWith('inmemory://model/1', {
      line: 0,
      character: 6,
    });
    expect(result.suggestions).toEqual([
      {
        label: 'CNOT',
        kind: 1,
        insertText: 'CNOT',
        range: { startLineNumber: 1, endLineNumber: 1, startColumn: 5, endColumn: 7 },
      },
    ]);
  });

  it('degrades to empty results when the language service throws', async () => {
    const model = createFakeModel('inmemory://model/1', 'qsharp');
    const fake = createFakeMonaco([model]);
    const { ls, mocks } = createFakeLanguageService();
    mocks.getCompletions.mockRejectedValue(new Error('worker died'));
    mocks.getHover.mockRejectedValue(new Error('worker died'));

    registerQsharpProviders(fake.api, ls);
    const completion = fake.completionProviders[0] as {
      provideCompletionItems(model: unknown, position: unknown): Promise<unknown>;
    };
    const hover = fake.hoverProviders[0] as {
      provideHover(model: unknown, position: unknown): Promise<unknown>;
    };

    await expect(
      completion.provideCompletionItems(model, { lineNumber: 1, column: 1 }),
    ).resolves.toEqual({ suggestions: [] });
    await expect(hover.provideHover(model, { lineNumber: 1, column: 1 })).resolves.toBeNull();
  });

  it('returns the three registration disposables so providers can be unregistered', () => {
    const fake = createFakeMonaco([]);
    const { ls } = createFakeLanguageService();

    const disposables = registerQsharpProviders(fake.api, ls);

    expect(disposables).toHaveLength(3);
    disposables.forEach((disposable) => disposable.dispose());
    expect(fake.disposedTags).toEqual(['completion', 'hover', 'signatureHelp']);
  });
});

describe('raceWithInitTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with a descriptive error when init hangs past the timeout', async () => {
    const hangingInit = new Promise<never>(() => {});
    const raced = raceWithInitTimeout(hangingInit, 15_000);
    const assertion = expect(raced).rejects.toThrow(
      /timed out after 15000ms.*stalled/s,
    );

    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it('passes through a fast init and clears the pending timeout timer', async () => {
    const raced = raceWithInitTimeout(Promise.resolve('ready'), 15_000);

    await expect(raced).resolves.toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('passes through a fast rejection (init failure beats the timeout)', async () => {
    const raced = raceWithInitTimeout(Promise.reject(new Error('wasm 404')), 15_000);

    await expect(raced).rejects.toThrow('wasm 404');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ensureQsharpLanguageService', () => {
  it('resolves (with a warning) when the qsharp-lang import fails, and is idempotent', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stubMonaco = {} as Monaco;

    const first = ensureQsharpLanguageService(stubMonaco);
    const second = ensureQsharpLanguageService(stubMonaco);
    expect(second).toBe(first);

    await expect(first).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('qsharp-ls');

    // Still idempotent after settling — no second init, no second warning.
    await expect(ensureQsharpLanguageService(stubMonaco)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  it('disposeQsharpLanguageService resets the latch so the next ensure re-inits', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stubMonaco = {} as Monaco;

    const before = ensureQsharpLanguageService(stubMonaco);
    await before;

    // Simulates the HMR dispose hook: the module-level latch must reset so
    // the re-evaluated module (or a retry) starts a fresh init.
    disposeQsharpLanguageService();

    const after = ensureQsharpLanguageService(stubMonaco);
    expect(after).not.toBe(before);
    await expect(after).resolves.toBeUndefined();
    // A fresh init attempt was made (and failed again under the mock).
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});
