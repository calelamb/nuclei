// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GradientHeatmapCircuit } from './GradientHeatmapCircuit';
import { circuitSnapshotFixture, gradientsFixture, inspectionFixture } from '../../services/trainability/fixtures';
import { useCircuitStore } from '../../stores/circuitStore';

afterEach(cleanup);

const paramGates = () => screen.getAllByRole('img', { name: /^θ\[/ });

describe('GradientHeatmapCircuit', () => {
  it('shows an empty state without a circuit', () => {
    render(<GradientHeatmapCircuit snapshot={null} inspection={null} gradients={undefined} />);
    expect(screen.getByText('No circuit to paint yet')).toBeTruthy();
  });

  it('shows a skeleton while loading with no circuit', () => {
    const { container } = render(<GradientHeatmapCircuit snapshot={null} inspection={null} gradients={undefined} loading />);
    expect(container.querySelector('.lab-skeleton')).toBeTruthy();
  });

  it('outlines parameterized gates before gradients exist', () => {
    render(<GradientHeatmapCircuit snapshot={circuitSnapshotFixture} inspection={inspectionFixture} gradients={undefined} />);
    expect(paramGates()).toHaveLength(6);
    expect(paramGates()[0].getAttribute('aria-label')).toContain('variance not measured');
    expect(screen.getByText(/run gradients to tint them/)).toBeTruthy();
  });

  it('tints gates on the sequential ramp and hatches dead gates', () => {
    const { container } = render(
      <GradientHeatmapCircuit snapshot={circuitSnapshotFixture} inspection={inspectionFixture} gradients={gradientsFixture} />,
    );
    const rects = paramGates().map((g) => g.querySelector('rect')!.getAttribute('style') ?? '');
    expect(rects[0]).toContain('var(--lab-seq-8)');
    expect(rects[3]).toMatch(/var\(--lab-seq-\d\)/);
    const dead = paramGates()[5];
    expect(dead.getAttribute('aria-label')).toContain('dead gate');
    expect(dead.querySelector('rect')!.getAttribute('style')).toMatch(/url\("?#/);
    expect(container.querySelector('pattern')).toBeTruthy();
    expect(screen.getByLabelText(/Var\[∂C\/∂θ\] \(log\):/)).toBeTruthy();
    expect(container.querySelector('.lab-sr-only')?.textContent).toMatch(/6 of 6 parameterized gates measured, 1 dead/);
    expect(JSON.stringify(container.innerHTML)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('shows parameter, variance and E|∂C/∂θ| on hover', () => {
    render(<GradientHeatmapCircuit snapshot={circuitSnapshotFixture} inspection={inspectionFixture} gradients={gradientsFixture} />);
    fireEvent.pointerEnter(paramGates()[0], { clientX: 40, clientY: 40 });
    const tip = document.querySelector('.lab-tooltip');
    expect(tip?.textContent).toContain('θ[0]');
    expect(tip?.textContent).toContain('Var[∂C/∂θ]');
    expect(tip?.textContent).toContain('0.031');
    expect(tip?.textContent).toContain('E|∂C/∂θ|');
    fireEvent.pointerLeave(paramGates()[0]);
    expect(document.querySelector('.lab-tooltip')).toBeNull();
  });

  it('never writes to circuitStore', () => {
    useCircuitStore.setState({ snapshot: circuitSnapshotFixture });
    const before = useCircuitStore.getState();
    render(<GradientHeatmapCircuit snapshot={before.snapshot} inspection={inspectionFixture} gradients={gradientsFixture} />);
    fireEvent.pointerEnter(paramGates()[0]);
    expect(useCircuitStore.getState()).toBe(before);
    expect(useCircuitStore.getState().snapshot).toBe(circuitSnapshotFixture);
  });
});
