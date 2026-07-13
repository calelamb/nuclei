// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';
import { PanelHeader } from './PanelHeader';

afterEach(() => cleanup());

describe('<PanelHeader> (PRD 11 Phase C)', () => {
  it('renders title, context, and an actions slot', () => {
    const { getByText } = render(
      <PanelHeader title="Bloch Sphere" context="theta-sweep" actions={<button>Do thing</button>} />,
    );
    expect(getByText('Bloch Sphere')).toBeTruthy();
    expect(getByText('theta-sweep')).toBeTruthy();
    expect(getByText('Do thing')).toBeTruthy();
  });

  it('shows no overflow button when no overflow actions are given', () => {
    const { queryByRole } = render(<PanelHeader title="Plain" />);
    expect(queryByRole('button', { name: 'Panel options' })).toBeNull();
  });

  it('opens an overflow menu with Hide panel / Reset layout / Help and fires them', () => {
    const onHide = vi.fn();
    const onResetLayout = vi.fn();
    const { getByRole } = render(
      <PanelHeader
        title="Bloch Sphere"
        onHide={onHide}
        onResetLayout={onResetLayout}
        helpHref="https://example.test/docs"
      />,
    );
    fireEvent.click(getByRole('button', { name: 'Panel options' }));
    const menu = getByRole('menu', { name: 'Bloch Sphere panel options' });
    fireEvent.click(within(menu).getByText('Hide panel'));
    expect(onHide).toHaveBeenCalledTimes(1);
    // Menu closes after an action.
    expect(document.querySelector('[role="menu"]')).toBeNull();

    fireEvent.click(getByRole('button', { name: 'Panel options' }));
    fireEvent.click(within(getByRole('menu')).getByText('Reset layout'));
    expect(onResetLayout).toHaveBeenCalledTimes(1);
  });

  it('renders a leading slot (e.g. a back button)', () => {
    const { getByText } = render(
      <PanelHeader title="run-123" leading={<button>Back</button>} />,
    );
    expect(getByText('Back')).toBeTruthy();
  });
});
