// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PathText } from './PathText';

afterEach(cleanup);

describe('<PathText />', () => {
  it('keeps the text intact and offers a break opportunity only after each slash', () => {
    const { container } = render(<p><PathText path="circuits/repetition.stim" /></p>);
    expect(container.textContent).toBe('circuits/repetition.stim');
    expect(container.querySelectorAll('wbr')).toHaveLength(1);
    expect(container.querySelector('p')?.innerHTML).toBe('circuits/<wbr>repetition.stim');
  });

  it('adds no break opportunity to a bare name', () => {
    const { container } = render(<p><PathText path="capture.dets" /></p>);
    expect(container.querySelectorAll('wbr')).toHaveLength(0);
  });
});
