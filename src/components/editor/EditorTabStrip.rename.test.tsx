// @vitest-environment jsdom
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EditorTabStrip } from './EditorTabStrip';
import { useProjectStore } from '../../stores/projectStore';

beforeEach(() => {
  useProjectStore.setState({ tabs: [], activeTabPath: null });
});
afterEach(cleanup);

function mountStrip() {
  return render(<EditorTabStrip stripRef={createRef<HTMLDivElement>()} onMeasure={() => {}} onOverflowing={() => {}} />);
}

describe('renaming the unsaved-buffer tab', () => {
  it('returns focus to the tab after Escape instead of dropping it on <body>', async () => {
    mountStrip();
    const tab = screen.getByRole('tab');
    tab.focus();
    fireEvent.keyDown(tab, { key: 'F2' });
    const input = screen.getByLabelText('Rename file');
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });
    expect(screen.queryByLabelText('Rename file')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('tab'));
  });
});
