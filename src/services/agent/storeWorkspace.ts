import { useEditorStore } from '../../stores/editorStore';
import { useProjectStore } from '../../stores/projectStore';
import { hashContent } from './hash';
import type { ApplyPatchResult, WorkspacePort } from './interfaces';
import type { PatchTransaction, WorkspaceFile } from './types';

const FALLBACK_PATH = 'editor';

/**
 * Live WorkspacePort adapter over the editor. Single active buffer for now
 * (multi-file workspaces land later) — the active path is whichever tab
 * projectStore currently has open, falling back to a synthetic 'editor'
 * path when no project tab is open (the common ephemeral-session case).
 *
 * Only the active buffer is writable: applyPatch against any other path is
 * reported as a conflict rather than silently no-op'd or creating a
 * phantom file, since this adapter has nowhere to persist an edit to a
 * path that isn't the live Monaco buffer.
 */
export class StoreWorkspace implements WorkspacePort {
  private readonly transactions = new Map<string, PatchTransaction>();
  private txnCounter = 0;

  activePath(): string {
    return useProjectStore.getState().activeTabPath ?? FALLBACK_PATH;
  }

  listFiles(): WorkspaceFile[] {
    const { code, framework } = useEditorStore.getState();
    return [{ path: this.activePath(), framework, content: code, dirty: false }];
  }

  readFile(path: string): WorkspaceFile | null {
    if (path !== this.activePath()) return null;
    const { code, framework } = useEditorStore.getState();
    return { path, framework, content: code, dirty: false };
  }

  applyPatch(path: string, newContent: string, expectedBeforeHash?: string): ApplyPatchResult {
    const beforeContent = useEditorStore.getState().code;
    const beforeHash = hashContent(beforeContent);

    if (path !== this.activePath()) {
      return { conflict: true, currentHash: beforeHash };
    }
    if (expectedBeforeHash !== undefined && expectedBeforeHash !== beforeHash) {
      return { conflict: true, currentHash: beforeHash };
    }

    const afterHash = hashContent(newContent);
    this.txnCounter += 1;
    const transaction: PatchTransaction = {
      id: `store_txn_${this.txnCounter}_${afterHash}`,
      path,
      beforeContent,
      afterContent: newContent,
      beforeHash,
      afterHash,
      appliedAt: Date.now(),
      rolledBack: false,
    };

    useEditorStore.getState().setCode(newContent);
    this.transactions.set(transaction.id, transaction);

    return transaction;
  }

  rollback(transactionId: string): boolean {
    const transaction = this.transactions.get(transactionId);
    if (!transaction || transaction.rolledBack) return false;

    const currentHash = hashContent(useEditorStore.getState().code);
    if (currentHash !== transaction.afterHash) return false;

    useEditorStore.getState().setCode(transaction.beforeContent);
    this.transactions.set(transactionId, { ...transaction, rolledBack: true });
    return true;
  }

  /**
   * Look up a previously applied transaction by id. Not part of
   * WorkspacePort — the live UI layer uses this to hydrate a full
   * PatchTransaction (including before/after content) from the compact
   * `{transactionId, path, ...}` evidence an apply_patch tool_result
   * carries, so agentRunStore can show a real Rollback affordance.
   */
  getTransaction(transactionId: string): PatchTransaction | undefined {
    return this.transactions.get(transactionId);
  }
}

/**
 * App-wide singleton. The agent always operates on "the editor" (there is
 * only one live Monaco buffer), so a single shared instance lets the
 * running orchestrator and the UI's Rollback button agree on the same
 * transaction registry without threading a workspace reference through
 * props.
 */
export const storeWorkspace = new StoreWorkspace();
