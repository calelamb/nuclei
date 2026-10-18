import { useDialogStore } from '../../stores/dialogStore';
import { Button, Dialog } from '../ui';

/**
 * Save / Don't save / Cancel guard for closing a dirty tab. Escape and a
 * scrim click map to Cancel (the safe, non-destructive choice), never to
 * "Don't save", so a stray keypress can't discard the user's edits. Focus
 * starts on Cancel for the same reason.
 */
export function UnsavedChangesModal() {
  const pending = useDialogStore((s) => s.pendingClose);
  const clearPending = useDialogStore((s) => s.clearPendingClose);
  if (!pending) return null;
  const { fileName, onSave, onDontSave, onCancel } = pending;

  const cancel = () => {
    onCancel();
    clearPending();
  };

  return (
    <Dialog
      title={`Save changes to ${fileName}?`}
      description="Your unsaved edits will be lost if you don't save."
      onClose={cancel}
      hideClose
      footer={(
        <>
          <Button onClick={cancel}>Cancel</Button>
          <Button variant="danger" onClick={async () => { await onDontSave(); clearPending(); }}>Don't save</Button>
          <Button variant="primary" onClick={async () => { await onSave(); clearPending(); }}>Save</Button>
        </>
      )}
    />
  );
}
