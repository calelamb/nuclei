import type { JournalPort } from './interfaces';
import type { JournalEntry } from './types';

/** Array-backed JournalPort. Entries are immutable once appended. */
export class InMemoryJournal implements JournalPort {
  private log: JournalEntry[] = [];

  append(entry: JournalEntry): void {
    this.log = [...this.log, entry];
  }

  entries(): JournalEntry[] {
    return [...this.log];
  }
}

/** JSON round-trip helpers so a run journal can be persisted later without
 * coupling this layer to any particular storage mechanism. */
export function serializeJournal(entries: JournalEntry[]): string {
  return JSON.stringify(entries);
}

export function deserializeJournal(json: string): JournalEntry[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed as JournalEntry[];
}
