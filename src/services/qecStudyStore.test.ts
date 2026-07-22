import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QecStudyFs } from './qecStudyFs';
import { useQecStudyStore } from './qecStudyStore';

const GOOD_STUDY = `schema: 1
id: good
name: Good study
question: Does it work?
preset: analyze
sources: []
`;

interface MemoryStudyFs extends QecStudyFs {
  files: Map<string, string>;
  emitWatch: () => void;
  unwatch: ReturnType<typeof vi.fn>;
}

function memoryStudyFs(initialFiles: Record<string, string>): MemoryStudyFs {
  const files = new Map(Object.entries(initialFiles));
  const watchers = new Set<() => void>();
  const join = (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/');
  const unwatch = vi.fn();

  return {
    files,
    unwatch,
    join,
    async exists(path) {
      return files.has(path) || [...files.keys()].some((file) => file.startsWith(`${path}/`));
    },
    async mkdir() {},
    async readTextFile(path) {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    async readDir(path) {
      const prefix = `${path}/`;
      return [...files.keys()]
        .filter((file) => file.startsWith(prefix))
        .map((file) => ({ name: file.slice(prefix.length), isDirectory: false }));
    },
    async writeTextFile(path, content) {
      files.set(path, content);
    },
    async watch(_path, callback) {
      watchers.add(callback);
      return () => {
        watchers.delete(callback);
        unwatch();
      };
    },
    emitWatch() {
      watchers.forEach((watcher) => watcher());
    },
  };
}

function resetStore(): void {
  useQecStudyStore.getState().stopWatching();
  useQecStudyStore.setState({
    studies: [],
    validationErrors: [],
    loading: false,
  });
}

describe('qecStudyStore', () => {
  afterEach(resetStore);

  it('discovers valid Studies and reports malformed files without crashing', async () => {
    const fs = memoryStudyFs({
      '/p/studies/good.qec-study.yaml': GOOD_STUDY,
      '/p/studies/bad.qec-study.yaml': 'schema: nope',
    });

    await useQecStudyStore.getState().reload('/p', fs);

    const state = useQecStudyStore.getState();
    expect(state.studies).toHaveLength(1);
    expect(state.studies[0].fileName).toBe('good.qec-study.yaml');
    expect(state.validationErrors[0].fileName).toBe('bad.qec-study.yaml');
  });

  it('does not overwrite an existing Study during create', async () => {
    const fs = memoryStudyFs({ '/p/studies/good.qec-study.yaml': GOOD_STUDY });
    const study = {
      schema: 1 as const,
      id: 'good',
      name: 'Replacement',
      question: 'Would overwrite?',
      preset: 'build' as const,
      tags: [],
      sources: [],
    };

    await expect(useQecStudyStore.getState().create('/p', study, fs)).rejects.toThrow(
      'A Study named "good" already exists.',
    );
    expect(fs.files.get('/p/studies/good.qec-study.yaml')).toBe(GOOD_STUDY);
  });

  it('keeps a later project reload when an earlier project reload finishes last', async () => {
    let releaseFirstRead: (() => void) | undefined;
    const fs = memoryStudyFs({
      '/one/studies/one.qec-study.yaml': GOOD_STUDY.replace('id: good', 'id: one'),
      '/two/studies/two.qec-study.yaml': GOOD_STUDY.replace('id: good', 'id: two'),
    });
    const read = fs.readTextFile;
    fs.readTextFile = async (path) => {
      if (path.includes('/one/')) {
        await new Promise<void>((resolve) => {
          releaseFirstRead = resolve;
        });
      }
      return read(path);
    };

    const first = useQecStudyStore.getState().reload('/one', fs);
    await Promise.resolve();
    const second = useQecStudyStore.getState().reload('/two', fs);
    await second;
    releaseFirstRead?.();
    await first;

    expect(useQecStudyStore.getState().studies.map(({ study }) => study.id)).toEqual(['two']);
  });

  it('does not add a Study from a create that finishes after a project switch', async () => {
    let releaseWrite: (() => void) | undefined;
    const fs = memoryStudyFs({
      '/two/studies/two.qec-study.yaml': GOOD_STUDY.replace('id: good', 'id: two'),
    });
    fs.writeTextFile = async (path, content) => {
      await new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      fs.files.set(path, content);
    };
    const created = {
      schema: 1 as const,
      id: 'one',
      name: 'One study',
      question: 'Will this be stale?',
      preset: 'build' as const,
      tags: [],
      sources: [],
    };

    const creating = useQecStudyStore.getState().create('/one', created, fs);
    await vi.waitFor(() => expect(releaseWrite).toBeTypeOf('function'));
    await useQecStudyStore.getState().reload('/two', fs);
    releaseWrite?.();
    await creating;

    expect(useQecStudyStore.getState().studies.map(({ study }) => study.id)).toEqual(['two']);
  });

  it('replaces state immutably after a watcher reload and cleans up the prior watcher', async () => {
    const first = memoryStudyFs({ '/p/studies/good.qec-study.yaml': GOOD_STUDY });
    const second = memoryStudyFs({ '/next/studies/next.qec-study.yaml': GOOD_STUDY.replace('id: good', 'id: next') });

    await useQecStudyStore.getState().reload('/p', first);
    const before = useQecStudyStore.getState().studies;
    await useQecStudyStore.getState().startWatching('/p', first);
    await useQecStudyStore.getState().startWatching('/next', second);
    expect(first.unwatch).toHaveBeenCalledOnce();

    first.files.set('/p/studies/stale.qec-study.yaml', GOOD_STUDY.replace('id: good', 'id: stale'));
    first.emitWatch();
    await Promise.resolve();
    expect(useQecStudyStore.getState().studies).toBe(before);

    second.emitWatch();
    await vi.waitFor(() => {
      expect(useQecStudyStore.getState().studies).not.toBe(before);
      expect(useQecStudyStore.getState().studies.map(({ study }) => study.id)).toEqual(['next']);
    });

    useQecStudyStore.getState().stopWatching();
    expect(second.unwatch).toHaveBeenCalledOnce();
  });
});
