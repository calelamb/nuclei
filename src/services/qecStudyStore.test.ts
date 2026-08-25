import { afterEach, describe, expect, it, vi } from 'vitest';
import { QecStudyFileExistsError, type QecStudyFs } from './qecStudyFs';
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
  watchedPaths: string[];
  symlinks: Set<string>;
  emitWatch: (paths?: readonly string[]) => void;
  unwatch: ReturnType<typeof vi.fn>;
}

function memoryStudyFs(initialFiles: Record<string, string>): MemoryStudyFs {
  const files = new Map(Object.entries(initialFiles));
  const watchers = new Set<(paths: readonly string[]) => void>();
  const join = (...parts: string[]) => parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/');
  const unwatch = vi.fn();
  const watchedPaths: string[] = [];
  const symlinks = new Set<string>();

  return {
    files,
    watchedPaths,
    symlinks,
    unwatch,
    join,
    async resolvePath(...parts) { return join(...parts); },
    async isSymlink(path) { return symlinks.has(path); },
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
        .map((file) => ({
          name: file.slice(prefix.length),
          isDirectory: false,
          isSymlink: symlinks.has(file),
        }));
    },
    async createTextFileExclusive(projectRoot, fileName, content) {
      const path = join(projectRoot, 'studies', fileName);
      if (files.has(path)) throw new QecStudyFileExistsError(path);
      files.set(path, content);
    },
    async watch(path, callback) {
      watchedPaths.push(path);
      watchers.add(callback);
      return () => {
        watchers.delete(callback);
        unwatch();
      };
    },
    emitWatch(paths = ['/p/studies/change.qec-study.yaml']) {
      watchers.forEach((watcher) => watcher(paths));
    },
  };
}

function resetStore(): void {
  useQecStudyStore.getState().clear();
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

  it('uses secure manifest reads when the desktop filesystem provides them', async () => {
    const fs = memoryStudyFs({});
    fs.readStudyManifests = vi.fn(async () => [
      { fileName: 'good.qec-study.yaml', content: GOOD_STUDY, error: null },
      { fileName: 'linked.qec-study.yaml', content: null, error: 'symbolic link rejected' },
    ]);
    fs.readTextFile = vi.fn(async () => { throw new Error('ambient read must not run'); });

    await useQecStudyStore.getState().reload('/p', fs);

    expect(useQecStudyStore.getState().studies.map(({ study }) => study.id)).toEqual(['good']);
    expect(useQecStudyStore.getState().studies[0].path).toBe(
      '/p/studies/good.qec-study.yaml',
    );
    expect(useQecStudyStore.getState().validationErrors).toEqual([
      { fileName: 'linked.qec-study.yaml', errors: ['symbolic link rejected'] },
    ]);
    expect(fs.readTextFile).not.toHaveBeenCalled();
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

  it('delegates desktop creation entirely to the secure project boundary', async () => {
    const fs = memoryStudyFs({});
    let created: string | null = null;
    fs.readStudyManifests = vi.fn(async () => created
      ? [{ fileName: 'secure.qec-study.yaml', content: created, error: null }]
      : []);
    fs.resolvePath = vi.fn(async () => { throw new Error('ambient resolve must not run'); });
    fs.isSymlink = vi.fn(async () => { throw new Error('ambient lstat must not run'); });
    fs.mkdir = vi.fn(async () => { throw new Error('ambient mkdir must not run'); });
    fs.createTextFileExclusive = vi.fn(async (_root, _fileName, content) => {
      created = content;
    });
    const study = {
      schema: 1 as const, id: 'secure', name: 'Secure', question: 'Handle relative?',
      preset: 'build' as const, tags: [], sources: [],
    };

    await expect(useQecStudyStore.getState().create('/p', study, fs)).resolves.toBe(
      '/p/studies/secure.qec-study.yaml',
    );

    expect(fs.createTextFileExclusive).toHaveBeenCalledWith(
      '/p',
      'secure.qec-study.yaml',
      expect.any(String),
    );
    expect(fs.resolvePath).not.toHaveBeenCalled();
    expect(fs.isSymlink).not.toHaveBeenCalled();
    expect(fs.mkdir).not.toHaveBeenCalled();
  });

  it('uses exclusive creation when another writer wins after the preflight check', async () => {
    const fs = memoryStudyFs({});
    const external = GOOD_STUDY.replace('name: Good study', 'name: External writer');
    let existenceChecks = 0;
    fs.exists = async (path) => {
      if (!path.endsWith('.qec-study.yaml')) return true;
      existenceChecks += 1;
      if (existenceChecks === 1) return false;
      return fs.files.has(path);
    };
    fs.createTextFileExclusive = vi.fn(async (projectRoot, fileName, content) => {
      const path = fs.join(projectRoot, 'studies', fileName);
      fs.files.set(path, external);
      if (fs.files.has(path)) throw new QecStudyFileExistsError(path);
      fs.files.set(path, content);
    });
    const study = {
      schema: 1 as const, id: 'racing', name: 'Racing', question: 'Who wins?',
      preset: 'build' as const, tags: [], sources: [],
    };

    await expect(useQecStudyStore.getState().create('/p', study, fs)).rejects.toThrow(
      'A Study named "racing" already exists.',
    );
    expect(fs.files.get('/p/studies/racing.qec-study.yaml')).toBe(external);
  });

  it('rejects a target resolved outside the project root', async () => {
    const fs = memoryStudyFs({});
    const normalJoin = fs.join;
    fs.join = (...parts) => parts.at(-1)?.endsWith('.qec-study.yaml')
      ? '/outside/escaped.qec-study.yaml'
      : normalJoin(...parts);
    const study = {
      schema: 1 as const, id: 'escaped', name: 'Escaped', question: 'Contained?',
      preset: 'build' as const, tags: [], sources: [],
    };

    await expect(useQecStudyStore.getState().create('/p', study, fs)).rejects.toThrow(/outside the project/i);
    expect(fs.files.has('/outside/escaped.qec-study.yaml')).toBe(false);
  });

  it('serializes concurrent creates for the same Study target', async () => {
    const releaseWrites: Array<() => void> = [];
    let notifySecondWrite: (() => void) | undefined;
    const secondWriteStarted = new Promise<void>((resolve) => {
      notifySecondWrite = resolve;
    });
    let writeCount = 0;
    const fs = memoryStudyFs({});
    const createTextFileExclusive = vi.fn(async (
      projectRoot: string,
      fileName: string,
      content: string,
    ) => {
      const path = fs.join(projectRoot, 'studies', fileName);
      writeCount += 1;
      if (writeCount === 2) notifySecondWrite?.();
      await new Promise<void>((resolve) => {
        releaseWrites.push(resolve);
      });
      fs.files.set(path, content);
    });
    fs.createTextFileExclusive = createTextFileExclusive;
    const study = {
      schema: 1 as const,
      id: 'same',
      name: 'One Study',
      question: 'Can this race?',
      preset: 'build' as const,
      tags: [],
      sources: [],
    };

    const first = useQecStudyStore.getState().create('/p', study, fs);
    await vi.waitFor(() => expect(createTextFileExclusive).toHaveBeenCalledOnce());
    const second = useQecStudyStore.getState().create('/p', study, fs);
    const secondRejection = expect(second).rejects.toThrow('A Study named "same" already exists.');
    const secondOutcome = second.then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    );
    const observed = await Promise.race([
      secondOutcome,
      secondWriteStarted.then(() => 'wrote' as const),
    ]);

    releaseWrites.forEach((release) => release());
    await expect(first).resolves.toBe('/p/studies/same.qec-study.yaml');
    await secondRejection;
    expect(observed).toBe('rejected');
    expect(createTextFileExclusive).toHaveBeenCalledOnce();
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

  it('keeps both authoritative results for concurrent different-id creates', async () => {
    const fs = memoryStudyFs({});
    const releases = new Map<string, () => void>();
    fs.createTextFileExclusive = async (projectRoot, fileName, content) => {
      const path = fs.join(projectRoot, 'studies', fileName);
      if (path.includes('/first.')) {
        await new Promise<void>((resolve) => releases.set('first', resolve));
      }
      fs.files.set(path, content);
    };
    const makeStudy = (id: string) => ({
      schema: 1 as const, id, name: id, question: `${id}?`, preset: 'build' as const,
      tags: [], sources: [],
    });

    const first = useQecStudyStore.getState().create('/p', makeStudy('first'), fs);
    await vi.waitFor(() => expect(releases.has('first')).toBe(true));
    await useQecStudyStore.getState().create('/p', makeStudy('second'), fs);
    releases.get('first')?.();
    await first;

    expect(useQecStudyStore.getState().validationErrors).toEqual([]);
    expect(useQecStudyStore.getState().studies.map(({ study }) => study.id)).toEqual(['first', 'second']);
  });

  it('does not add a Study from a create that finishes after a project switch', async () => {
    let releaseWrite: (() => void) | undefined;
    const fs = memoryStudyFs({
      '/two/studies/two.qec-study.yaml': GOOD_STUDY.replace('id: good', 'id: two'),
    });
    fs.createTextFileExclusive = async (projectRoot, fileName, content) => {
      const path = fs.join(projectRoot, 'studies', fileName);
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

  it('invalidates a pending reload when watching switches to another project', async () => {
    let releaseRead: (() => void) | undefined;
    const fs = memoryStudyFs({
      '/one/studies/one.qec-study.yaml': GOOD_STUDY.replace('id: good', 'id: one'),
      '/two/studies/two.qec-study.yaml': GOOD_STUDY.replace('id: good', 'id: two'),
    });
    const read = fs.readTextFile;
    fs.readTextFile = async (path) => {
      if (path.includes('/one/')) {
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
      }
      return read(path);
    };

    const reloading = useQecStudyStore.getState().reload('/one', fs);
    await vi.waitFor(() => expect(releaseRead).toBeTypeOf('function'));
    await useQecStudyStore.getState().startWatching('/two', fs);
    releaseRead?.();
    await reloading;

    expect(useQecStudyStore.getState().studies).toEqual([]);
  });

  it('watches the stable project root without probing the mutable Studies path', async () => {
    const fs = memoryStudyFs({});
    fs.exists = async () => {
      throw new Error('permission denied');
    };

    await useQecStudyStore.getState().startWatching('/p', fs);

    expect(fs.watchedPaths).toEqual(['/p']);
    expect(useQecStudyStore.getState().validationErrors).toEqual([]);
  });

  it('surfaces an actionable error when watcher registration fails', async () => {
    const fs = memoryStudyFs({ '/p/studies/good.qec-study.yaml': GOOD_STUDY });
    fs.watch = async () => {
      throw new Error('watch service unavailable');
    };

    await useQecStudyStore.getState().startWatching('/p', fs);

    expect(useQecStudyStore.getState().validationErrors).toEqual([
      {
        fileName: 'studies',
        errors: ['Could not watch the Studies folder: watch service unavailable'],
      },
    ]);
  });

  it('watches the project root until an initially absent Studies directory appears', async () => {
    const fs = memoryStudyFs({});
    await useQecStudyStore.getState().startWatching('/p', fs);
    expect(fs.watchedPaths).toEqual(['/p']);

    fs.files.set('/p/studies/good.qec-study.yaml', GOOD_STUDY);
    fs.emitWatch();
    await vi.waitFor(() => {
      expect(fs.watchedPaths).toEqual(['/p']);
      expect(useQecStudyStore.getState().studies.map(({ study }) => study.id)).toEqual(['good']);
    });
  });

  it('surfaces root-watcher refresh failures without an unhandled rejection', async () => {
    const fs = memoryStudyFs({});
    fs.resolvePath = async () => { throw new Error('refresh permission denied'); };
    await useQecStudyStore.getState().startWatching('/p', fs);

    fs.emitWatch();

    await vi.waitFor(() => {
      expect(useQecStudyStore.getState().validationErrors).toContainEqual({
        fileName: 'studies',
        errors: ['refresh permission denied'],
      });
    });
  });

  it('ignores unrelated project-root events without reloading Studies', async () => {
    const fs = memoryStudyFs({ '/p/studies/good.qec-study.yaml': GOOD_STUDY });
    fs.readDir = vi.fn(fs.readDir);
    await useQecStudyStore.getState().startWatching('/p', fs);

    fs.emitWatch(['/p/src/main.ts']);
    await Promise.resolve();

    expect(fs.readDir).not.toHaveBeenCalled();
  });

  it('quarantines every manifest in a duplicate Study id collision', async () => {
    const fs = memoryStudyFs({
      '/p/studies/a.qec-study.yaml': GOOD_STUDY,
      '/p/studies/b.qec-study.yaml': GOOD_STUDY.replace('name: Good study', 'name: Duplicate'),
    });
    await useQecStudyStore.getState().reload('/p', fs);

    expect(useQecStudyStore.getState().studies).toEqual([]);
    expect(useQecStudyStore.getState().validationErrors).toEqual([
      { fileName: 'a.qec-study.yaml', errors: [expect.stringContaining('duplicate Study id "good"')] },
      { fileName: 'b.qec-study.yaml', errors: [expect.stringContaining('duplicate Study id "good"')] },
    ]);
  });

  it('rejects symlinked Studies directories and manifest entries', async () => {
    const linkedDirectory = memoryStudyFs({ '/p/studies/good.qec-study.yaml': GOOD_STUDY });
    linkedDirectory.symlinks.add('/p/studies');
    await useQecStudyStore.getState().reload('/p', linkedDirectory);
    expect(useQecStudyStore.getState().studies).toEqual([]);
    expect(useQecStudyStore.getState().validationErrors[0].errors[0]).toMatch(/symbolic link/i);

    resetStore();
    const linkedManifest = memoryStudyFs({ '/p/studies/good.qec-study.yaml': GOOD_STUDY });
    linkedManifest.symlinks.add('/p/studies/good.qec-study.yaml');
    await useQecStudyStore.getState().reload('/p', linkedManifest);
    expect(useQecStudyStore.getState().studies).toEqual([]);
    expect(useQecStudyStore.getState().validationErrors).toEqual([{
      fileName: 'good.qec-study.yaml',
      errors: ['Study manifests cannot be symbolic links.'],
    }]);
  });

  it('rejects a symlinked Studies directory before attempting creation', async () => {
    const fs = memoryStudyFs({});
    fs.symlinks.add('/p/studies');
    fs.mkdir = vi.fn(async () => undefined);
    const study = {
      schema: 1 as const, id: 'linked', name: 'Linked', question: 'Safe?',
      preset: 'build' as const, tags: [], sources: [],
    };

    await expect(useQecStudyStore.getState().create('/p', study, fs)).rejects.toThrow(/symbolic link/i);
    expect(fs.mkdir).not.toHaveBeenCalled();
    expect(fs.files).toEqual(new Map());
  });

  it('watches the project root rather than a symlinked Studies directory', async () => {
    const fs = memoryStudyFs({ '/p/studies/good.qec-study.yaml': GOOD_STUDY });
    fs.symlinks.add('/p/studies');

    await useQecStudyStore.getState().reload('/p', fs);
    await useQecStudyStore.getState().startWatching('/p', fs);

    expect(fs.watchedPaths).toEqual(['/p']);
    expect(useQecStudyStore.getState().validationErrors[0].errors[0]).toMatch(/symbolic link/i);
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

    second.emitWatch(['/next/studies/change.qec-study.yaml']);
    await vi.waitFor(() => {
      expect(useQecStudyStore.getState().studies).not.toBe(before);
      expect(useQecStudyStore.getState().studies.map(({ study }) => study.id)).toEqual(['next']);
    });

    useQecStudyStore.getState().stopWatching();
    expect(second.unwatch).toHaveBeenCalledOnce();
  });
});
