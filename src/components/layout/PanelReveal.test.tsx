// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PanelReveal } from './PanelReveal';

afterEach(() => cleanup());

describe('<PanelReveal>', () => {
  it('renders children when when=true', () => {
    const { queryByText } = render(
      <PanelReveal when={true}>
        <div>revealed</div>
      </PanelReveal>,
    );
    expect(queryByText('revealed')).not.toBeNull();
  });

  it('does not render children when when=false', () => {
    const { queryByText } = render(
      <PanelReveal when={false}>
        <div>hidden</div>
      </PanelReveal>,
    );
    expect(queryByText('hidden')).toBeNull();
  });

  it('applies translate origin attribute based on "from" prop', () => {
    const { container } = render(
      <PanelReveal when={true} from="right">
        <div>x</div>
      </PanelReveal>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute('data-reveal-from')).toBe('right');
  });

  it('exposes data-reveal-root for CSS hooks', () => {
    const { container } = render(
      <PanelReveal when={true}>
        <div>x</div>
      </PanelReveal>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.hasAttribute('data-reveal-root')).toBe(true);
  });
});
