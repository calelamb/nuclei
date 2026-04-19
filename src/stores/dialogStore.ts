import { create } from 'zustand';

export interface PendingClose {
  fileName: string;
  onSave: () => Promise<void> | void;
  onDontSave: () => Promise<void> | void;
  onCancel: () => void;
}

interface DialogState {
  pendingClose: PendingClose | null;
  requestClose: (p: PendingClose) => void;
  clearPendingClose: () => void;
}

/**
 * Ephemeral modal state for the unsaved-changes close confirm. Kept as its
 * own store so any component that triggers a close (tab bar, project switch,
 * app exit) can request the same modal without plumbing callbacks through.
 */
export const useDialogStore = create<DialogState>((set) => ({
  pendingClose: null,
  requestClose: (p) => set({ pendingClose: p }),
  clearPendingClose: () => set({ pendingClose: null }),
}));
