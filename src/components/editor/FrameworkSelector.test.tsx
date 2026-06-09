// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { FrameworkSelector } from './FrameworkSelector';
import { PlatformProvider } from '../../platform/PlatformProvider';
import { useEditorStore } from '../../stores/editorStore';
import { STARTER_TEMPLATES } from '../../data/starterTemplates';
import type { PlatformBridge } from '../../platform/bridge';

// Minimal desktop bridge: the selector only calls getPlatform(), but the
// provider wants the full interface.
const desktopBridge: PlatformBridge = {
  async startKernel() { return 'ok'; },
  async stopKernel() { return 'ok'; },
  async openFile() { return null; },
  async readFile() { return null; },
  async saveFile() {},
  async saveFileAs() { return null; },
  async renameFile() { return null; },
  async getStoredValue() { return null; },
  async setStoredValue() {},
  async setWindowTitle() {},
  getPlatform() { return 'desktop'; },
  async openDirectory() { return null; },
  async listDirectory() { return null; },
  async createFile() { return null; },
  async createDirectory() { return null; },
  async deleteFile() { return false; },
};

function renderSelector() {
  return render(
    <PlatformProvider bridge={desktopBridge}>
      <FrameworkSelector />
    </PlatformProvider>,
  );
}

function pickFramework(name: string) {
  fireEvent.click(screen.getByTitle('Framework'));
  // The "Framework" section item is named exactly e.g. 'Q# (QDK)'; the
  // template section item is 'New Q# (QDK) file', so the query is
  // unambiguous.
  fireEvent.click(screen.getByRole('button', { name }));
}

const pickQsharp = () => pickFramework('Q# (QDK)');

describe('FrameworkSelector — Q#', () => {
  beforeEach(() => {
    useEditorStore.setState({
      code: STARTER_TEMPLATES.qiskit,
      framework: 'qiskit',
      filePath: null,
      isDirty: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useEditorStore.setState({
      code: STARTER_TEMPLATES.qiskit,
      framework: 'qiskit',
      filePath: null,
      isDirty: false,
    });
  });

  it('swaps in the Q# starter when the buffer is an untouched starter', () => {
    renderSelector();
    pickQsharp();

    const state = useEditorStore.getState();
    expect(state.framework).toBe('qsharp');
    expect(state.code).toBe(STARTER_TEMPLATES.qsharp);
  });

  it('keeps a dirty buffer intact and only flips the label within the Python family', () => {
    const userCode = 'from qiskit import QuantumCircuit\n# my homework in progress\n';
    useEditorStore.setState({ code: userCode, isDirty: true });

    renderSelector();
    pickFramework('Cirq');

    const state = useEditorStore.getState();
    expect(state.framework).toBe('cirq');
    expect(state.code).toBe(userCode);
  });

  it('cross-boundary pick on a dirty buffer is a no-op when the confirm is cancelled', () => {
    const userCode = 'from qiskit import QuantumCircuit\n# my homework in progress\n';
    useEditorStore.setState({ code: userCode, isDirty: true });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    renderSelector();
    pickQsharp();

    expect(confirmSpy).toHaveBeenCalledOnce();
    const state = useEditorStore.getState();
    expect(state.framework).toBe('qiskit');
    expect(state.code).toBe(userCode);
    expect(state.isDirty).toBe(true);
  });

  it('cross-boundary pick on a dirty buffer swaps in the Q# starter when confirmed', () => {
    const userCode = 'from qiskit import QuantumCircuit\n# my homework in progress\n';
    useEditorStore.setState({ code: userCode, isDirty: true, filePath: '/work/homework.py' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderSelector();
    pickQsharp();

    const state = useEditorStore.getState();
    expect(state.framework).toBe('qsharp');
    expect(state.code).toBe(STARTER_TEMPLATES.qsharp);
    // Detached from the .py path — the buffer no longer matches that file.
    expect(state.filePath).toBeNull();
  });
});
