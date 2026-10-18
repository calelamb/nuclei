import type { ReactNode } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';

export interface ConfirmOptions {
  title: string;
  /** One sentence on what happens; say what is lost when the action is destructive. */
  description?: ReactNode;
  /** The verb the person is agreeing to ("Discard", "Delete"), never a bare "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` styles the confirm button as destructive. */
  tone?: 'default' | 'danger';
}

export interface ConfirmDialogProps extends ConfirmOptions {
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The one confirmation. The safe action (cancel) takes focus, Escape and the scrim cancel, the
 * confirm button is last and names its verb, and focus returns to whatever opened it.
 * Replaces window.confirm everywhere.
 */
export function ConfirmDialog({
  title, description, confirmLabel, cancelLabel = 'Cancel', tone = 'default', onConfirm, onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      title={title}
      description={description}
      width={400}
      onClose={onCancel}
      hideClose
      initialFocus="[data-confirm-cancel]"
      footer={(
        <>
          <Button variant="ghost" data-confirm-cancel="" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )}
    />
  );
}
