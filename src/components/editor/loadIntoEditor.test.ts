import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadIntoEditor } from './loadIntoEditor';
import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore } from '../../stores/projectStore';
import { STARTER_TEMPLATES } from '../../data/starterTemplates';

const WORK = '# MY IMPORTANT WORK\n';
const DEMO = 'from qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\n';

function resetStores(editor: Partial<ReturnType<typeof useEditorStore.getState>> = {}) {
  useProjectStore.setState({ tabs: [], activeTabPath: null });
  useEditorStore.setState({ code: STARTER_TEMPLATES.qiskit, framework: 'qiskit', filePath: null, isDirty: false, focusRequest: 0, ...editor });
}

describe('loadIntoEditor', () => {
  beforeEach(() => resetStores());

  it('replaces an untouched buffer without asking', async () => {
    const confirm = vi.fn(async () => true);
    const result = await loadIntoEditor(DEMO, { label: 'demo code', confirm, framework: 'cirq' });
    expect(confirm).not.toHaveBeenCalled();
    expect(result).toBe('replaced');
    expect(useEditorStore.getState().code).toBe(DEMO);
    expect(useEditorStore.getState().framework).toBe('cirq');
  });

  it('asks before replacing a dirty buffer and names what replaces it', async () => {
    resetStores({ code: WORK, isDirty: true });
    const confirm = vi.fn(async () => true);
    await loadIntoEditor(DEMO, { label: 'demo code', confirm });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toMatchObject({ title: 'Replace your code with the demo code?', confirmLabel: 'Replace', cancelLabel: 'Keep editing' });
    expect(useEditorStore.getState().code).toBe(DEMO);
  });

  it('leaves the dirty buffer alone when the confirm is cancelled', async () => {
    resetStores({ code: WORK, isDirty: true });
    const result = await loadIntoEditor(DEMO, { label: 'demo code', confirm: async () => false });
    expect(result).toBe('cancelled');
    expect(useEditorStore.getState().code).toBe(WORK);
    expect(useEditorStore.getState().isDirty).toBe(true);
  });

  it('does not ask when the dirty buffer is just another untouched starter', async () => {
    resetStores({ code: STARTER_TEMPLATES.cirq, isDirty: true });
    const confirm = vi.fn(async () => true);
    await loadIntoEditor(DEMO, { label: 'demo code', confirm });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('in project mode opens a new memory tab and leaves the open file untouched', async () => {
    useProjectStore.getState().openTab({ path: '/p/bell.py', content: 'my work' });
    useEditorStore.setState({ code: 'my work', isDirty: true, filePath: '/p/bell.py' });
    const confirm = vi.fn(async () => true);
    const result = await loadIntoEditor(DEMO, { label: 'starter', confirm, tabName: 'qrng-step1.py' });
    expect(confirm).not.toHaveBeenCalled();
    expect(result).toBe('opened-tab');
    const { tabs, activeTabPath } = useProjectStore.getState();
    expect(tabs.find((t) => t.path === '/p/bell.py')?.content).toBe('my work');
    expect(activeTabPath).toBe('memory://qrng-step1.py');
    expect(useEditorStore.getState().code).toBe(DEMO);
  });

  it('picks a free tab name when the same starter is loaded twice', async () => {
    useProjectStore.getState().openTab({ path: '/p/bell.py', content: 'x' });
    const confirm = async () => true;
    await loadIntoEditor(DEMO, { label: 'starter', confirm, tabName: 'step.py' });
    await loadIntoEditor(DEMO, { label: 'starter', confirm, tabName: 'step.py' });
    const paths = useProjectStore.getState().tabs.map((t) => t.path);
    expect(paths).toContain('memory://step.py');
    expect(paths).toContain('memory://step-2.py');
  });

  it('detaches from the open file so saving cannot overwrite it', async () => {
    resetStores({ code: 'x', filePath: '/p/a.py', isDirty: false });
    await loadIntoEditor(DEMO, { label: 'demo code', confirm: async () => true });
    expect(useEditorStore.getState().filePath).toBeNull();
  });
});
