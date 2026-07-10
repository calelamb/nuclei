import { describe, expect, it, vi } from 'vitest';
import type { JournalEntry } from './types';
import { StoreJournal } from './storeJournal';

describe('StoreJournal', () => {
  it('forwards every appended entry to onEntry, in order', () => {
    const seen: JournalEntry[] = [];
    const journal = new StoreJournal({ onEntry: (entry) => seen.push(entry) });

    const first: JournalEntry = { kind: 'model_text', ts: 1, text: 'thinking...' };
    const second: JournalEntry = {
      kind: 'tool_call',
      ts: 2,
      toolCallId: 'call_1',
      tool: 'inspect_project',
      input: {},
    };

    journal.append(first);
    journal.append(second);

    expect(seen).toEqual([first, second]);
  });

  it('entries() mirrors InMemoryJournal semantics — immutable snapshot, append-only', () => {
    const journal = new StoreJournal({ onEntry: () => {} });
    const entry: JournalEntry = { kind: 'error', ts: 5, message: 'boom' };
    journal.append(entry);

    const snapshot = journal.entries();
    expect(snapshot).toEqual([entry]);

    // Mutating the returned array must not affect the journal's own state.
    snapshot.push({ kind: 'error', ts: 6, message: 'injected' });
    expect(journal.entries()).toEqual([entry]);
  });

  it('onEntry is called even if it throws does not corrupt internal state for subsequent appends', () => {
    const onEntry = vi.fn().mockImplementationOnce(() => {
      throw new Error('callback exploded');
    });
    const journal = new StoreJournal({ onEntry });

    const first: JournalEntry = { kind: 'error', ts: 1, message: 'first' };
    expect(() => journal.append(first)).toThrow('callback exploded');

    // The entry was still recorded internally before the callback threw.
    expect(journal.entries()).toEqual([first]);

    onEntry.mockImplementationOnce(() => {});
    const second: JournalEntry = { kind: 'error', ts: 2, message: 'second' };
    journal.append(second);
    expect(journal.entries()).toEqual([first, second]);
  });

  it('propagates state_change entries verbatim', () => {
    const seen: JournalEntry[] = [];
    const journal = new StoreJournal({ onEntry: (entry) => seen.push(entry) });
    const entry: JournalEntry = { kind: 'state_change', ts: 1, from: 'planning', to: 'working' };
    journal.append(entry);
    expect(seen[0]).toEqual(entry);
  });
});
