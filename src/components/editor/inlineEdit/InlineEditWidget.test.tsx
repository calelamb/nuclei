// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Monaco } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { InlineEditWidget } from './InlineEditWidget';
import { PlatformProvider, type PlatformBridge } from '../../../platform/PlatformProvider';
import { useDiracStore } from '../../../stores/diracStore';
import { useDiracPanelStore } from '../../../stores/diracPanelStore';

const bridge = {
  getPlatform: () => 'web',
  getStoredValue: vi.fn(async () => null),
  setStoredValue: vi.fn(async () => undefined),
} as unknown as PlatformBridge;

type Listener = (e?: unknown) => void;
const listeners: Record<string, Listener[]> = {};
function hook(name: string) {
  return (cb: Listener) => {
    (listeners[name] ??= []).push(cb);
    return { dispose: () => { listeners[name] = (listeners[name] ?? []).filter((l) => l !== cb); } };
  };
}
function fire(name: string, e?: unknown) { [...(listeners[name] ?? [])].forEach((l) => l(e)); }

function fakeEditor() {
  const model = { getValueInRange: () => '', getLineContent: () => 'qc.h(0)', getLineMaxColumn: () => 8 };
  return {
    focus: vi.fn(),
    getSelection: () => ({ isEmpty: () => true, positionLineNumber: 1, endLineNumber: 1 }),
    getModel: () => model,
    getTopForLineNumber: () => 0,
    getScrollTop: () => 0,
    onDidChangeModelContent: hook('content'),
    onDidChangeCursorPosition: hook('cursor'),
    onKeyDown: hook('keydown'),
  } as unknown as monaco.editor.IStandaloneCodeEditor;
}

function mount(onClose = vi.fn()) {
  const editor = fakeEditor();
  render(
    <PlatformProvider bridge={bridge}>
      <InlineEditWidget editor={editor} monaco={{} as Monaco} onClose={onClose} />
    </PlatformProvider>,
  );
  return { editor, onClose };
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); Object.keys(listeners).forEach((k) => delete listeners[k]); useDiracStore.setState({ apiKey: '' }); });

describe('InlineEditWidget with a key', () => {
  beforeEach(() => useDiracStore.setState({ apiKey: 'sk-ant-test' }));

  it('Escape closes the widget and returns focus to the editor (interaction-r-02)', () => {
    const { editor, onClose } = mount();
    fireEvent.keyDown(screen.getByPlaceholderText(/Describe the change/), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(editor.focus).toHaveBeenCalled();
  });
});

describe('InlineEditWidget without a key (interaction-r-03)', () => {
  beforeEach(() => useDiracStore.setState({ apiKey: '' }));

  it('offers an Add API key action instead of an input that eats the prompt', () => {
    mount();
    expect(screen.getByText('Connect Dirac to use AI edits')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/Describe the change/)).toBeNull();
  });

  it('Add API key closes the widget and opens the Dirac panel key field', () => {
    useDiracPanelStore.setState({ isOpen: false, focusSignal: 0 });
    const { onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add API key' }));
    expect(onClose).toHaveBeenCalled();
    expect(useDiracPanelStore.getState().isOpen).toBe(true);
    expect(useDiracPanelStore.getState().focusSignal).toBe(1);
  });

  it('Escape still dismisses and restores editor focus', () => {
    const { editor, onClose } = mount();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Add API key' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(editor.focus).toHaveBeenCalled();
  });
});

describe('InlineEditWidget error voice and focus (interaction-r-02)', () => {
  beforeEach(() => useDiracStore.setState({ apiKey: 'sk-ant-test' }));

  it('a rejected key reads like the chat panel and offers Update key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const { onClose } = mount();
    const input = screen.getByPlaceholderText(/Describe the change/);
    fireEvent.change(input, { target: { value: 'add a qubit' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    await screen.findByText('Your Anthropic key was rejected');
    fireEvent.click(screen.getByRole('button', { name: /Update key/ }));
    expect(onClose).toHaveBeenCalled();
    expect(useDiracPanelStore.getState().keyEntryOpen).toBe(true);
  });

  it('keeps focus in the instruction field while loading and after the reply', async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((r) => { release = r; })));
    mount();
    const input = screen.getByPlaceholderText(/Describe the change/) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'add a qubit' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(true);
    expect(document.activeElement).toBe(input);
    await act(async () => { release(new Response('{}', { status: 429 })); });
    await waitFor(() => expect(input.readOnly).toBe(false));
    expect(document.activeElement).toBe(input);
    expect(screen.getByText('Rate limited')).toBeTruthy();
  });

  it('Escape from anywhere inside the widget closes it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    const { onClose, editor } = mount();
    const input = screen.getByPlaceholderText(/Describe the change/);
    fireEvent.change(input, { target: { value: 'x' } });
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
    await screen.findByRole('alert');
    fireEvent.keyDown(screen.getByRole('alert'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(editor.focus).toHaveBeenCalled();
  });

  it('Escape pressed in the code while the widget is open closes it (interaction-r-03)', () => {
    const { onClose } = mount();
    act(() => fire('keydown', { browserEvent: { key: 'Escape' } }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('InlineEditWidget without a key lingers no longer (interaction-r-03)', () => {
  beforeEach(() => useDiracStore.setState({ apiKey: '' }));

  it('has a Dismiss control', () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the code changes or the cursor leaves its line', () => {
    const first = mount();
    act(() => fire('content'));
    expect(first.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const second = mount();
    act(() => fire('cursor', { position: { lineNumber: 1 } }));
    expect(second.onClose).not.toHaveBeenCalled();
    act(() => fire('cursor', { position: { lineNumber: 5 } }));
    expect(second.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when focus moves to something outside the widget', () => {
    const { onClose } = mount();
    const outside = document.createElement('textarea');
    document.body.appendChild(outside);
    fireEvent.blur(screen.getByRole('button', { name: 'Add API key' }), { relatedTarget: outside });
    expect(onClose).toHaveBeenCalledTimes(1);
    outside.remove();
  });
});
