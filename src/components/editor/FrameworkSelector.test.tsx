// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/react';
import { FrameworkSelector } from './FrameworkSelector';
import { PlatformProvider } from '../../platform/PlatformProvider';
import { useProjectStore } from '../../stores/projectStore';
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
  fireEvent.click(screen.getByLabelText('Framework'));
  // The "Framework" section item is named exactly e.g. 'Q# (QDK)'; the
  // template section item is 'New Q# (QDK) file', so the query is
  // unambiguous.
  fireEvent.click(screen.getByRole('menuitemradio', { name }));
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

  it('cross-boundary pick on a dirty buffer is a no-op when the confirm is cancelled', async () => {
    const userCode = 'from qiskit import QuantumCircuit\n# my homework in progress\n';
    useEditorStore.setState({ code: userCode, isDirty: true });
    const nativeSpy = vi.spyOn(window, 'confirm');

    renderSelector();
    pickQsharp();

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Replace your code with the Q# (QDK) starter?');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(nativeSpy).not.toHaveBeenCalled();
    const state = useEditorStore.getState();
    expect(state.framework).toBe('qiskit');
    expect(state.code).toBe(userCode);
    expect(state.isDirty).toBe(true);
  });

  it('cross-boundary pick on a dirty buffer swaps in the Q# starter when confirmed', async () => {
    const userCode = 'from qiskit import QuantumCircuit\n# my homework in progress\n';
    useEditorStore.setState({ code: userCode, isDirty: true, filePath: '/work/homework.py' });
    renderSelector();
    pickQsharp();
    fireEvent.click(await screen.findByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(useEditorStore.getState().framework).toBe('qsharp'));
    const state = useEditorStore.getState();
    expect(state.framework).toBe('qsharp');
    expect(state.code).toBe(STARTER_TEMPLATES.qsharp);
    // Detached from the .py path — the buffer no longer matches that file.
    expect(state.filePath).toBeNull();
  });
});

describe('FrameworkSelector — project tabs', () => {
  afterEach(() => { cleanup(); useProjectStore.setState({ tabs: [], activeTabPath: null }); });

  it('New Cirq file opens a new memory tab and leaves the open file tab untouched', () => {
    useProjectStore.setState({ tabs: [], activeTabPath: null });
    useProjectStore.getState().openTab({ path: '/p/bell.py', content: 'my work' });
    useEditorStore.setState({ code: 'my work', isDirty: false, filePath: '/p/bell.py', framework: 'qiskit' });
    renderSelector();
    fireEvent.click(screen.getByLabelText('Framework'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'New Cirq file' }));
    const { tabs, activeTabPath } = useProjectStore.getState();
    expect(tabs.find((t) => t.path === '/p/bell.py')?.content).toBe('my work');
    expect(activeTabPath).toBe('memory://untitled-1.py');
    expect(tabs.find((t) => t.path === activeTabPath)?.content).toBe(STARTER_TEMPLATES.cirq);
    expect(useEditorStore.getState().code).toBe(STARTER_TEMPLATES.cirq);
  });
});

describe('FrameworkSelector — compact label', () => {
  const webBridge: PlatformBridge = { ...desktopBridge, getPlatform() { return 'web'; } };
  afterEach(cleanup);

  it('shortens the browser-subset label in compact mode and keeps it in the tooltip', () => {
    useEditorStore.setState({ framework: 'qiskit' });
    render(
      <PlatformProvider bridge={webBridge}>
        <FrameworkSelector compact />
      </PlatformProvider>,
    );
    const trigger = screen.getByRole('button', { name: /qiskit/i });
    expect(trigger.textContent).toBe('Qiskit');
    expect(trigger.getAttribute('aria-label')).toBe('Framework: Qiskit (browser subset)');
  });

  it('shows the full label when there is room', () => {
    useEditorStore.setState({ framework: 'qiskit' });
    render(
      <PlatformProvider bridge={webBridge}>
        <FrameworkSelector />
      </PlatformProvider>,
    );
    expect(screen.getByLabelText('Framework').textContent).toBe('Qiskit (browser subset)');
  });
});

describe('FrameworkSelector — New X file (research-r-01)', () => {
  const BELL = 'import cirq\n# bell.py on disk\n';
  const pickTemplate = (name: string) => {
    fireEvent.click(screen.getByLabelText('Framework'));
    fireEvent.click(screen.getByRole('menuitem', { name }));
  };
  beforeEach(() => {
    useEditorStore.setState({ code: BELL, framework: 'cirq', filePath: '/p/bell.py', isDirty: false, focusRequest: 0 });
  });
  afterEach(() => {
    cleanup();
    useEditorStore.setState({ code: STARTER_TEMPLATES.qiskit, framework: 'qiskit', filePath: null, isDirty: false });
  });

  it('never writes into a tab that has a filePath: the starter lands in an untitled buffer', () => {
    renderSelector();
    pickTemplate('New Cirq file');
    const s = useEditorStore.getState();
    expect(s.filePath).toBeNull();
    expect(s.code).toBe(STARTER_TEMPLATES.cirq);
    expect(s.isDirty).toBe(true); // untitled.py*, so Cmd+S asks for a name rather than overwriting bell.py
    expect(s.focusRequest).toBeGreaterThan(0);
  });

  it('confirms before discarding unsaved edits, and leaves them alone when kept', async () => {
    useEditorStore.setState({ code: `${BELL}# edit`, isDirty: true });
    renderSelector();
    pickTemplate('New Cirq file');
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useEditorStore.getState().filePath).toBe('/p/bell.py');
    expect(useEditorStore.getState().code).toBe(`${BELL}# edit`);
  });

  it('moves focus to the editor after a confirmed cross-language replace (interaction-r-16)', async () => {
    useEditorStore.setState({ code: `${BELL}# edit`, isDirty: true });
    renderSelector();
    pickQsharp();
    fireEvent.click(await screen.findByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(useEditorStore.getState().framework).toBe('qsharp'));
    expect(useEditorStore.getState().focusRequest).toBeGreaterThan(0);
  });
});
