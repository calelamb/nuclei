// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QecImportSheet } from './QecImportSheet';

describe('QecImportSheet on the shared Dialog (qec-r-28)', () => {
  afterEach(cleanup);

  it('is a named modal dialog that carries the source', () => {
    render(<QecImportSheet source="captures/a.parquet" onDismiss={vi.fn()}><button>inside</button></QecImportSheet>);
    const dialog = screen.getByRole('dialog', { name: 'Import source' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('captures/a.parquet');
  });

  it('dismisses on Escape, from the document, once', () => {
    const onDismiss = vi.fn();
    render(<QecImportSheet source="a" onDismiss={onDismiss}><button>inside</button></QecImportSheet>);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('does not lose a half-finished mapping to a stray scrim click', () => {
    const onDismiss = vi.fn();
    render(<QecImportSheet source="a" onDismiss={onDismiss}><button>inside</button></QecImportSheet>);
    fireEvent.mouseDown(screen.getByTestId('dialog-scrim'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('closes from the labelled close button', () => {
    const onDismiss = vi.fn();
    render(<QecImportSheet source="a" onDismiss={onDismiss}><button>inside</button></QecImportSheet>);
    fireEvent.click(screen.getByRole('button', { name: 'Close import wizard' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
