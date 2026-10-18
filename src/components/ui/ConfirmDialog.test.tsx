// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useConfirm } from './useConfirm';

afterEach(cleanup);

function Host({ onResult }: { onResult: (ok: boolean) => void }) {
  const { confirm, confirmDialog } = useConfirm();
  return (
    <>
      <button onClick={async () => onResult(await confirm({ title: 'Discard changes?', description: 'Your edits will be lost.', confirmLabel: 'Discard', tone: 'danger' }))}>
        Open
      </button>
      {confirmDialog}
    </>
  );
}

async function open() {
  const results: boolean[] = [];
  render(<Host onResult={(ok) => results.push(ok)} />);
  const opener = screen.getByText('Open');
  opener.focus();
  await act(async () => { fireEvent.click(opener); });
  return { results, opener };
}

describe('useConfirm', () => {
  it('shows a labelled dialog with the safe action focused', async () => {
    await open();
    expect(screen.getByRole('dialog', { name: 'Discard changes?' })).toBeTruthy();
    expect(screen.getByText('Your edits will be lost.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('resolves true on the verb button and returns focus to the opener', async () => {
    const { results, opener } = await open();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Discard' })); });
    expect(results).toEqual([true]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('resolves false on Cancel and on Escape', async () => {
    const first = await open();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); });
    expect(first.results).toEqual([false]);
    cleanup();
    const second = await open();
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(second.results).toEqual([false]);
    expect(document.activeElement).toBe(second.opener);
  });

  it('has no stray Close button next to Cancel', async () => {
    await open();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});
