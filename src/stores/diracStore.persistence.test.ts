import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// All three functions are mocked at module level so the store's subscribe
// can exercise the debounce + coalescing without touching disk.
vi.mock('../lib/diracPersistence', async () => {
  const actual = await vi.importActual<typeof import('../lib/diracPersistence')>(
    '../lib/diracPersistence',
  );
  return {
    ...actual,
    readConversation: vi.fn(async () => null),
    writeConversation: vi.fn(async () => true),
  };
});

import {
  __flushPersistenceForTests,
  __setProjectRootGetter,
  useDiracStore,
} from './diracStore';
import * as persistence from '../lib/diracPersistence';

const writeSpy = persistence.writeConversation as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  useDiracStore.getState().resetConversation();
  __setProjectRootGetter(() => null); // Ephemeral path
  writeSpy.mockClear();
});

afterEach(async () => {
  // Drain any pending writes so subsequent tests don't see stray calls.
  await __flushPersistenceForTests();
  writeSpy.mockClear();
});

describe('diracStore persistence subscription', () => {
  it('does not persist until the first message is appended', async () => {
    // Changing a non-messages field should not trigger a write.
    useDiracStore.getState().setLoading(true);
    await __flushPersistenceForTests();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('coalesces rapid message edits into a single write', async () => {
    const store = useDiracStore.getState();
    store.addMessage({ role: 'user', content: 'hi' });
    store.addMessage({ role: 'assistant', content: '' });
    store.updateLastAssistant('h');
    store.updateLastAssistant('hi');
    store.updateLastAssistant('hi there');
    // Still within the debounce window; nothing written yet.
    expect(writeSpy).not.toHaveBeenCalled();

    await __flushPersistenceForTests();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const [projectRoot, conversation] = writeSpy.mock.calls[0];
    expect(projectRoot).toBeNull();
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages[1].content).toBe('hi there');
  });

  it('persists clearHistory as an empty-messages write (conversation_id stable)', async () => {
    const store = useDiracStore.getState();
    store.addMessage({ role: 'user', content: 'hi' });
    await __flushPersistenceForTests();
    const firstCallArgs = writeSpy.mock.calls.at(-1)!;
    const conversationId = firstCallArgs[1].conversation_id;

    store.clearHistory();
    await __flushPersistenceForTests();

    const lastCall = writeSpy.mock.calls.at(-1)!;
    expect(lastCall[1].messages).toEqual([]);
    // PRD: clear writes messages:[] but keeps the conversation_id so a
    // future "multiple conversations per project" migration has a stable
    // handle. Resetting the id would forfeit that.
    expect(lastCall[1].conversation_id).toBe(conversationId);
  });

  it('loadConversation adopts the persisted metadata', async () => {
    const loaded = {
      version: 1,
      conversation_id: 'loaded-abc',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:10:00Z',
      messages: [
        { id: 'm1', role: 'user' as const, content: 'prior', timestamp: '2026-01-01T00:00:30Z' },
      ],
    };
    useDiracStore.getState().loadConversation(loaded);
    const state = useDiracStore.getState();
    expect(state.messages).toHaveLength(1);
    expect(state.conversationMeta?.conversationId).toBe('loaded-abc');
    expect(state.conversationMeta?.createdAt).toBe('2026-01-01T00:00:00Z');

    // A subsequent message edit must reuse the loaded conversation_id.
    state.addMessage({ role: 'assistant', content: 'continuing' });
    await __flushPersistenceForTests();
    expect(writeSpy.mock.calls.at(-1)![1].conversation_id).toBe('loaded-abc');
  });

  it('routes writes to the current projectRoot via the registered getter', async () => {
    __setProjectRootGetter(() => '/tmp/some-project');
    useDiracStore.getState().addMessage({ role: 'user', content: 'x' });
    await __flushPersistenceForTests();
    expect(writeSpy.mock.calls.at(-1)![0]).toBe('/tmp/some-project');
  });

  it('coalesces a change arriving during an in-flight write into one follow-up write', async () => {
    // Make the write hang so we can push a second change mid-flight.
    let resolveFirst: () => void = () => {};
    writeSpy.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFirst = () => resolve(true);
        }),
    );

    const store = useDiracStore.getState();
    store.addMessage({ role: 'user', content: 'a' });
    // Flush to start the first write (it's now pending on resolveFirst).
    const flushPromise = __flushPersistenceForTests();

    // Queue a second change while the write is in flight.
    store.addMessage({ role: 'assistant', content: 'b' });

    // Let the first write finish.
    resolveFirst();
    await flushPromise;

    // The runtime should have detected the queued change and fired
    // exactly one follow-up write — never more. This ensures streaming
    // responses don't stack writes.
    // A tiny delay for the microtask that schedules the follow-up.
    await new Promise((r) => setTimeout(r, 0));
    expect(writeSpy).toHaveBeenCalledTimes(2);
  });

  it('generates id + timestamp on addMessage so callers never think about them', () => {
    useDiracStore.getState().addMessage({ role: 'user', content: 'hi' });
    const msg = useDiracStore.getState().messages[0];
    expect(msg.id).toMatch(/[0-9a-f-]{8,}/);
    expect(Number.isFinite(new Date(msg.timestamp).getTime())).toBe(true);
  });
});
