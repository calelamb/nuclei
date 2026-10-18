// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

function fakeEditor() {
  const model = { getValueInRange: () => '', getLineContent: () => 'qc.h(0)', getLineMaxColumn: () => 8 };
  return {
    focus: vi.fn(),
    getSelection: () => ({ isEmpty: () => true, positionLineNumber: 1, endLineNumber: 1 }),
    getModel: () => model,
    getTopForLineNumber: () => 0,
    getScrollTop: () => 0,
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
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useDiracStore.setState({ apiKey: '' }); });

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
