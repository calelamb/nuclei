// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LIGHT_COLORS } from '../../styles/tokens';
import { MultiSeriesTooltip } from './MultiSeriesTooltip';

afterEach(cleanup);

const ROWS = [
  { dataKey: 'run b', name: 'run b', value: 0.25, color: 'rgb(168, 88, 10)' },
  { dataKey: 'run a', name: 'run a', value: 0.5, color: 'rgb(8, 145, 178)' },
];
const order = (key: unknown) => (key === 'run a' ? 0 : 1);

describe('<MultiSeriesTooltip /> (design-r12-01)', () => {
  it('lists rows in legend order with the series colour on a swatch only', () => {
    const { container } = render(<MultiSeriesTooltip active label="|00>" payload={ROWS} colors={LIGHT_COLORS} order={order} />);
    const text = Array.from(container.querySelectorAll('.nuclei-chart-tooltip > div')).map((n) => n.textContent);
    expect(text).toEqual(['|00>', 'run a: 0.5000', 'run b: 0.2500']);
    const neutral = document.createElement('div');
    neutral.style.color = LIGHT_COLORS.text;
    const swatches = Array.from(container.querySelectorAll<HTMLElement>('[data-swatch]'));
    expect(swatches.map((n) => n.style.background)).toEqual(['rgb(8, 145, 178)', 'rgb(168, 88, 10)']);
    for (const swatch of swatches) expect(swatch.parentElement?.style.color).toBe(neutral.style.color);
  });

  it('renders nothing when inactive or empty', () => {
    expect(render(<MultiSeriesTooltip active={false} payload={ROWS} colors={LIGHT_COLORS} order={order} />).container.innerHTML).toBe('');
    expect(render(<MultiSeriesTooltip active payload={[]} colors={LIGHT_COLORS} order={order} />).container.innerHTML).toBe('');
  });
});
