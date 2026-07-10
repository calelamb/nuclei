import type { Framework } from '../../types/quantum';
import { hashContent } from './hash';
import type { ApplyPatchResult, WorkspacePort } from './interfaces';
import type { PatchTransaction, WorkspaceFile } from './types';

interface FileRecord {
  content: string;
  framework: Framework;
  dirty: boolean;
}

/**
 * In-memory implementation of WorkspacePort. Used directly by unit tests and
 * intended as the model other adapters (e.g. one backed by the real editor
 * store) should follow: every edit produces a PatchTransaction, and rollback
 * only succeeds while the file's content still matches what the patch left
 * behind — a cheap optimistic-concurrency check, not a full VCS.
 */
export class InMemoryWorkspace implements WorkspacePort {
  private readonly files: Map<string, FileRecord>;
  private readonly transactions: Map<string, PatchTransaction> = new Map();
  private readonly active: string;
  private txnCounter = 0;

  constructor(initialFiles: WorkspaceFile[], activePath?: string) {
    this.files = new Map(
      initialFiles.map((f) => [f.path, { content: f.content, framework: f.framework, dirty: f.dirty }]),
    );
    this.active = activePath ?? initialFiles[0]?.path ?? '';
  }

  listFiles(): WorkspaceFile[] {
    return Array.from(this.files.entries()).map(([path, record]) => ({
      path,
      framework: record.framework,
      content: record.content,
      dirty: record.dirty,
    }));
  }

  readFile(path: string): WorkspaceFile | null {
    const record = this.files.get(path);
    if (!record) return null;
    return { path, framework: record.framework, content: record.content, dirty: record.dirty };
  }

  applyPatch(path: string, newContent: string, expectedBeforeHash?: string): ApplyPatchResult {
    const existing = this.files.get(path);
    const beforeContent = existing?.content ?? '';
    const beforeHash = hashContent(beforeContent);

    if (expectedBeforeHash !== undefined && expectedBeforeHash !== beforeHash) {
      return { conflict: true, currentHash: beforeHash };
    }

    const afterHash = hashContent(newContent);
    this.txnCounter += 1;
    const transaction: PatchTransaction = {
      id: `txn_${this.txnCounter}_${afterHash}`,
      path,
      beforeContent,
      afterContent: newContent,
      beforeHash,
      afterHash,
      appliedAt: Date.now(),
      rolledBack: false,
    };

    this.files.set(path, {
      content: newContent,
      framework: existing?.framework ?? 'qiskit',
      dirty: true,
    });
    this.transactions.set(transaction.id, transaction);

    return transaction;
  }

  rollback(transactionId: string): boolean {
    const transaction = this.transactions.get(transactionId);
    if (!transaction || transaction.rolledBack) return false;

    const record = this.files.get(transaction.path);
    const currentHash = hashContent(record?.content ?? '');
    if (currentHash !== transaction.afterHash) return false;

    this.files.set(transaction.path, {
      content: transaction.beforeContent,
      framework: record?.framework ?? 'qiskit',
      dirty: true,
    });
    this.transactions.set(transactionId, { ...transaction, rolledBack: true });
    return true;
  }

  activePath(): string {
    return this.active;
  }
}
