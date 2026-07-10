import { InMemoryJournal } from './journal';
import type { JournalPort } from './interfaces';
import type { JournalEntry } from './types';

export interface StoreJournalCallbacks {
  /** Invoked synchronously with every entry as it's appended, so a live UI
   * (agentRunStore) can update in real time instead of only after the run
   * resolves. */
  onEntry: (entry: JournalEntry) => void;
}

/**
 * JournalPort that layers a live "notify on every append" hook on top of
 * InMemoryJournal. Takes plain callbacks rather than importing agentRunStore
 * directly, so it stays testable without a Zustand store (or React) in the
 * loop — the hook that constructs this wires `onEntry` to the store's
 * setters.
 */
export class StoreJournal implements JournalPort {
  private readonly inner = new InMemoryJournal();
  private readonly callbacks: StoreJournalCallbacks;

  constructor(callbacks: StoreJournalCallbacks) {
    this.callbacks = callbacks;
  }

  append(entry: JournalEntry): void {
    this.inner.append(entry);
    this.callbacks.onEntry(entry);
  }

  entries(): JournalEntry[] {
    return this.inner.entries();
  }
}
