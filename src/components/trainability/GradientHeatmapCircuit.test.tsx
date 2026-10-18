// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GradientHeatmapCircuit } from './GradientHeatmapCircuit';
import {
  circuitSnapshotFixture,
  gradientsFixture,
  gradientsPpeUnresolvedFixture,
  inspectionFixture,
} from '../../services/trainability/fixtures';
import { buildHeatmapModel } from './heatmapMath';
import { fixtureGates } from '../../services/trainability/fixtures';
import { useCircuitStore } from '../../stores/circuitStore';

afterEach(cleanup);

const paramGates = () => screen.getAllByRole('img', { name: /^θ\[/ });

describe('GradientHeatmapCircuit', () => {
  it('shows an empty state without a circuit or an inspection', () => {
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


describe('GradientHeatmapCircuit: unresolved gates (null variance)', () => {
  it('never tints an unresolved gate: distinct hatch, interval-only label and tooltip', () => {
    const { container } = render(
      <GradientHeatmapCircuit snapshot={circuitSnapshotFixture} inspection={inspectionFixture} gradients={gradientsPpeUnresolvedFixture} />,
    );
    const gates = paramGates();
    // Gate 0 resolved (tinted), gates 1..5 unresolved.
    expect(gates[0].querySelector('rect')!.getAttribute('style')).toMatch(/var\(--lab-seq-\d\)/);
    for (const g of gates.slice(1)) {
      expect(g.getAttribute('aria-label')).toContain('unresolved, interval only');
      expect(g.querySelector('rect')!.getAttribute('style')).toMatch(/url\("?#/);
      expect(g.querySelector('rect')!.getAttribute('style')).not.toMatch(/--lab-seq-/);
    }
    // Two different hatches: dead gates and unresolved gates never look alike.
    expect(container.querySelectorAll('pattern')).toHaveLength(2);
    expect(screen.getByText(/unresolved \(interval only\): 5/)).toBeTruthy();
    fireEvent.pointerEnter(gates[1], { clientX: 10, clientY: 10 });
    const tip = document.querySelector('.lab-tooltip')!;
    expect(tip.textContent).toContain('unresolved (interval only)');
    expect(tip.textContent).toContain('[0, 0.97]');
    expect(tip.textContent).not.toMatch(/\bnull\b|NaN/);
  });

  it('model: null variance is unresolved, not dead, not measured, and out of the domain', () => {
    const model = buildHeatmapModel(fixtureGates, inspectionFixture, gradientsPpeUnresolvedFixture);
    expect(model.unresolvedCount).toBe(5);
    expect(model.measuredCount).toBe(1);
    expect(model.deadCount).toBe(0);
    expect(model.byGateIndex.get(1)).toMatchObject({ unresolved: true, variance: null, t: null, dead: false });
  });
});

describe('GradientHeatmapCircuit: built from the Lab\'s own inspection (no circuitStore)', () => {
  it('draws the parameterized gates as a strip when there is no circuit snapshot', () => {
    render(<GradientHeatmapCircuit snapshot={null} inspection={inspectionFixture} gradients={gradientsFixture} />);
    expect(paramGates()).toHaveLength(6);
    expect(screen.getByRole('img', { name: 'Parameterized gates with gradient variance heatmap' })).toBeTruthy();
    expect(screen.getByText(/circuit diagram is not available here/)).toBeTruthy();
    expect(paramGates()[0].querySelector('rect')!.getAttribute('style')).toContain('var(--lab-seq-8)');
  });

  it('labels tinted tiles with the luminance-chosen ink token, never a fixed colour', () => {
    render(<GradientHeatmapCircuit snapshot={circuitSnapshotFixture} inspection={inspectionFixture} gradients={gradientsFixture} />);
    const label = paramGates()[0].querySelector('text')!;
    expect(label.getAttribute('style')).toContain('var(--lab-seq-ink-8)');
    expect(label.getAttribute('style')).not.toMatch(/stroke-width: 3/);
  });

  it('falls back to the strip when the snapshot has no matching parameterized gates', () => {
    render(
      <GradientHeatmapCircuit
        snapshot={{ ...circuitSnapshotFixture, gates: circuitSnapshotFixture.gates.filter((g) => g.type === 'CZ') }}
        inspection={inspectionFixture}
        gradients={undefined}
      />,
    );
    expect(paramGates()).toHaveLength(6);
  });
});
