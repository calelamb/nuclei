// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuantumPlayground } from './QuantumPlayground';
import { useThemeStore } from '../../stores/themeStore';

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: true, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('QuantumPlayground', () => {
  it('puts focus on the step action, not on Skip', () => {
    render(<QuantumPlayground onComplete={vi.fn()} onBridgeToIDE={vi.fn()} />);
    expect(document.activeElement?.textContent).toBe('Continue');
    click('Continue');
    expect(document.activeElement?.textContent).toBe('Apply H Gate');
  });

  it('shows the measured outcome on the Bloch arrow and in the histogram', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    render(<QuantumPlayground onComplete={vi.fn()} onBridgeToIDE={vi.fn()} />);
    click('Continue'); click('Apply H Gate'); click('Measure');
    expect(screen.getByRole('img', { name: /measured \|1⟩/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /\|0⟩ 0 times, \|1⟩ 1 times out of 1/ })).toBeTruthy();
  });

  it('"Measure 10 Times" yields exactly 10 shots, not 10 on top of the earlier one', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    render(<QuantumPlayground onComplete={vi.fn()} onBridgeToIDE={vi.fn()} />);
    click('Continue'); click('Apply H Gate'); click('Measure'); click('Measure 10 Times');
    expect(screen.getByRole('img', { name: /out of 10$/ })).toBeTruthy();
  });

  it('entangling shows a |00> / |11> histogram and matching arrows for both qubits', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    render(<QuantumPlayground onComplete={vi.fn()} onBridgeToIDE={vi.fn()} />);
    click('Continue'); click('Apply H Gate'); click('Measure'); click('Measure 10 Times'); click('Entangle qubits');
    expect(screen.getByRole('img', { name: /Joint results: \|00⟩ 0 times, \|11⟩ 10 times/ })).toBeTruthy();
    expect(screen.getAllByRole('img', { name: /measured \|1⟩/ })).toHaveLength(2);
  });

  it('the last step is "Start lesson 1" and bridges once', async () => {
    vi.useFakeTimers();
    const bridge = vi.fn();
    render(<QuantumPlayground onComplete={vi.fn()} onBridgeToIDE={bridge} />);
    click('Continue'); click('Apply H Gate'); click('Measure'); click('Measure 10 Times'); click('Entangle qubits');
    click('Start lesson 1');
    await vi.advanceTimersByTimeAsync(700);
    expect(bridge).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('never paints the |1⟩ bar in Dirac purple', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    render(<QuantumPlayground onComplete={vi.fn()} onBridgeToIDE={vi.fn()} />);
    click('Continue'); click('Apply H Gate'); click('Measure');
    const histogram = screen.getByRole('img', { name: /Measurement results/ });
    expect(histogram.innerHTML).not.toContain('rgb(123, 45, 142)');
  });

  it('draws a visible qubit outline with the pole labels outside the circle', () => {
    const { container } = render(<QuantumPlayground onComplete={vi.fn()} onBridgeToIDE={vi.fn()} />);
    const svg = container.querySelector('svg[role="img"]')!;
    const circle = svg.querySelector('circle')!;
    expect(circle.getAttribute('opacity')).toBeNull();
    expect(circle.getAttribute('stroke')).toBe(useThemeStore.getState().colors.borderStrong);

    const cy = Number(circle.getAttribute('cy'));
    const r = Number(circle.getAttribute('r'));
    const labels = Array.from(svg.querySelectorAll('text'));
    const top = labels.find((t) => t.textContent === '|0⟩')!;
    const bottom = labels.find((t) => t.textContent === '|1⟩')!;
    expect(Number(top.getAttribute('y'))).toBeLessThan(cy - r);
    // Baseline of the lower label sits below the circle, and the label stays inside the viewBox.
    expect(Number(bottom.getAttribute('y'))).toBeGreaterThan(cy + r);
    const height = Number(svg.getAttribute('viewBox')!.split(' ')[3]);
    expect(Number(bottom.getAttribute('y'))).toBeLessThanOrEqual(height);
  });

  it('puts a baseline under the histogram bars', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    render(<QuantumPlayground onComplete={vi.fn()} onBridgeToIDE={vi.fn()} />);
    click('Continue'); click('Apply H Gate'); click('Measure');
    expect(document.querySelectorAll('[data-bar-baseline]').length).toBeGreaterThan(0);
  });
});
