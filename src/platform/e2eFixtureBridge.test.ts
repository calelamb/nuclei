// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformBridge } from './bridge';
import { createE2eFixtureBridge } from './e2eFixtureBridge';

function baseBridge(): PlatformBridge {
  return {
    startKernel: vi.fn(async () => 'ready'), stopKernel: vi.fn(async () => 'stopped'),
    openFile: vi.fn(async () => null), readFile: vi.fn(async () => null),
    saveFile: vi.fn(async () => undefined), saveFileAs: vi.fn(async () => null),
    renameFile: vi.fn(async () => null), getStoredValue: vi.fn(async () => null),
    setStoredValue: vi.fn(async () => undefined), setWindowTitle: vi.fn(async () => undefined),
    getPlatform: () => 'web', openDirectory: vi.fn(async () => null),
    listDirectory: vi.fn(async () => null), createFile: vi.fn(async () => null),
    createDirectory: vi.fn(async () => null), deleteFile: vi.fn(async () => false),
  };
}

beforeEach(() => localStorage.clear());

describe('createE2eFixtureBridge', () => {
  it.each(['../qec-project', '/tmp/qec-project', String.raw`C:\tmp\qec-project`, 'missing'])(
    'rejects traversal, absolute, and unknown fixture requests: %s',
    (project) => {
      const query = new URLSearchParams({ e2eProject: project, workspace: 'research' });
      expect(createE2eFixtureBridge(baseBridge(), query)).toBeNull();
    },
  );

  it('exposes only the catalogued fixture project through a virtual project root', async () => {
    const bridge = createE2eFixtureBridge(
      baseBridge(),
      new URLSearchParams({ e2eProject: 'qec-project', workspace: 'research' }),
    );

    expect(bridge).not.toBeNull();
    if (!bridge) return;
    const root = await bridge.getStoredValue<string>('project_root');
    expect(root).toBe('tests/e2e/fixtures/qec-project');
    await expect(bridge.readFile(`${root}/circuits/repetition.stim`)).resolves.toContain('DETECTOR');
    await expect(bridge.readFile(`${root}/../outside.txt`)).resolves.toBeNull();
    await expect(bridge.readFile('/etc/passwd')).resolves.toBeNull();
    await expect(bridge.listDirectory(`${root}/studies`)).resolves.toEqual([
      {
        kind: 'file',
        name: 'surface-memory.qec-study.yaml',
        path: `${root}/studies/surface-memory.qec-study.yaml`,
      },
    ]);
    expect(localStorage.getItem('nuclei:workspace_mode_by_project')).toContain('research');
  });

  it('confines exclusive mutable files, directories, and storage to one bridge instance', async () => {
    const bridge = createE2eFixtureBridge(
      baseBridge(),
      new URLSearchParams({ e2eProject: 'qec-project', workspace: 'research' }),
    );
    expect(bridge).not.toBeNull();
    if (!bridge) return;
    const root = 'tests/e2e/fixtures/qec-project';
    const path = `${root}/studies/new.qec-study.yaml`;

    await expect(bridge.createFileExclusive?.(path, 'schema: 1')).resolves.toBe('created');
    await expect(bridge.createFileExclusive?.(path, 'replacement')).resolves.toBe('exists');
    await expect(bridge.readFile(path)).resolves.toBe('schema: 1');
    await expect(bridge.createDirectory(`${root}/results`, false)).resolves.toEqual({ path: `${root}/results` });
    await expect(bridge.listDirectory(root)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'results', kind: 'directory' }),
    ]));

    await bridge.setStoredValue('qec-workbench:test', { preset: 'observe' });
    await expect(bridge.getStoredValue('qec-workbench:test')).resolves.toEqual({ preset: 'observe' });
    await expect(bridge.createFileExclusive?.(`${root}/../outside.yaml`, 'bad')).resolves.toBeNull();
    await expect(bridge.createDirectory('/tmp/outside', true)).resolves.toBeNull();

    const isolated = createE2eFixtureBridge(
      baseBridge(),
      new URLSearchParams({ e2eProject: 'qec-project', workspace: 'research' }),
    );
    expect(isolated).not.toBeNull();
    if (!isolated) return;
    await expect(isolated.readFile(path)).resolves.toBeNull();
    await expect(isolated.getStoredValue('qec-workbench:test')).resolves.toBeNull();
  });

  it('does not inherit unknown storage keys from the ambient platform bridge', async () => {
    const base = baseBridge();
    base.getStoredValue = vi.fn(async () => ({ preset: 'ambient-observe' }));
    const bridge = createE2eFixtureBridge(
      base,
      new URLSearchParams({ e2eProject: 'qec-project', workspace: 'research' }),
    );

    expect(bridge).not.toBeNull();
    if (!bridge) return;
    await expect(bridge.getStoredValue('qec-workbench:unknown')).resolves.toBeNull();
    expect(base.getStoredValue).not.toHaveBeenCalled();
  });
});
