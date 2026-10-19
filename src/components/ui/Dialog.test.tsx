// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Dialog } from './Dialog';

afterEach(cleanup);

function Harness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open dialog</button>
      {open && (
        <Dialog title="Save changes?" onClose={() => { onClose(); setOpen(false); }} footer={<button>Save</button>}>
          <input aria-label="Name" />
        </Dialog>
      )}
    </>
  );
}

describe('Dialog default close', () => {
  it('renders a labelled Close button for a dismissible dialog and calls onClose', () => {
    const onClose = vi.fn();
    render(<Dialog title="Compose" onClose={onClose}><p>Body</p></Dialog>);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps focus off the Close button on open', () => {
    render(<Dialog title="Compose" onClose={() => {}}><input aria-label="Field" /></Dialog>);
    expect(document.activeElement).toBe(screen.getByLabelText('Field'));
  });

  it('does not add a second close when the caller supplies trailing, or when hideClose / not dismissible', () => {
    const { unmount } = render(<Dialog title="T" onClose={() => {}} trailing={<button>Mine</button>}><p>x</p></Dialog>);
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    unmount();
    const second = render(<Dialog title="T" onClose={() => {}} hideClose><p>x</p></Dialog>);
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    second.unmount();
    render(<Dialog title="T" onClose={() => {}} dismissible={false}><p>x</p></Dialog>);
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});

describe('Dialog', () => {
  it('is a labelled modal dialog named by its visible title', () => {
    render(<Dialog title="Launch on hardware" onClose={() => {}}><p>Body</p></Dialog>);
    const dialog = screen.getByRole('dialog', { name: 'Launch on hardware' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('moves focus inside on open and restores it to the opener on close', () => {
    render(<Harness />);
    const opener = screen.getByText('Open dialog');
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('autofocuses the first body control, not the header close button', () => {
    render(
      <Dialog title="Shortcuts" trailing={<button aria-label="Close">x</button>} onClose={() => {}} footer={<button>Done</button>}>
        <input aria-label="Filter" />
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText('Filter'));
  });

  it('falls back to the footer, then to the panel itself, never the close button', () => {
    const { unmount } = render(
      <Dialog title="T" trailing={<button aria-label="Close">x</button>} onClose={() => {}} footer={<button>Done</button>}>
        <p>Only text</p>
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByText('Done'));
    unmount();
    render(<Dialog title="T" trailing={<button aria-label="Close">x</button>} onClose={() => {}}><p>Only text</p></Dialog>);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('traps Tab inside the dialog', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Open dialog'));
    const save = screen.getByText('Save');
    save.focus();
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape and on a scrim click, but not on a click inside', () => {
    const onClose = vi.fn();
    render(<Dialog title="T" onClose={onClose}><p>Body</p></Dialog>);
    fireEvent.mouseDown(screen.getByText('Body'));
    fireEvent.click(screen.getByText('Body'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByTestId('dialog-scrim'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('can disable dismissal for blocking flows', () => {
    const onClose = vi.fn();
    render(<Dialog title="T" onClose={onClose} dismissible={false}><p>Body</p></Dialog>);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByTestId('dialog-scrim'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('paints the scrim with the scrim token', () => {
    render(<Dialog title="T" onClose={() => {}}>x</Dialog>);
    expect(screen.getByTestId('dialog-scrim').className).toContain('nuclei-dialog-scrim');
  });

  it('honours an initial focus target', () => {
    render(<Dialog title="T" onClose={() => {}} initialFocus="[data-primary]"><button>Cancel</button><button data-primary>Save</button></Dialog>);
    expect(document.activeElement?.textContent).toBe('Save');
  });
});

describe('Dialog initial focus', () => {
  it('focuses the initialFocus target and asks for a visible ring', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'focus');
    render(
      <Dialog title="Pick" onClose={() => {}} initialFocus="[data-pick]">
        <button>First</button>
        <button data-pick>Second</button>
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Second' }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ focusVisible: true }));
    spy.mockRestore();
  });
});

describe('top-anchored dialog maths (ui.css)', () => {
  const css = readFileSync(join(__dirname, 'ui.css'), 'utf8');
  const rule = (sel: string) => css.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

  it('caps the top offset so offset + height + bottom gutter never exceeds the viewport', () => {
    const scrim = rule('.nuclei-dialog-scrim.nuclei-dialog-scrim--top');
    expect(scrim).toMatch(/padding-top:\s*min\(15vh,\s*96px\)/);
    const panel = rule('.nuclei-dialog-scrim--top .nuclei-dialog');
    expect(panel).toMatch(/max-height:\s*calc\(100vh - min\(15vh,\s*96px\) - 24px\)/);
  });
});

describe('Dialog role', () => {
  it('defaults to dialog and accepts alertdialog', () => {
    const { rerender } = render(<Dialog title="A" onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'A' })).toBeTruthy();
    rerender(<Dialog title="A" role="alertdialog" onClose={() => {}} />);
    expect(screen.getByRole('alertdialog', { name: 'A' })).toBeTruthy();
  });
});
