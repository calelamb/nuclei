import { describe, expect, it } from 'vitest';
import { blochRailHeights } from './blochRail';
import { circuitMinHeight } from './circuitRail';
import { circuitWantedHeight, planRailSplit } from './railHeights';

// Heights the round-4 auditors measured: svgHeight of the diagram with a classical register.
const SVG_6Q = 355;
const SVG_5Q = 303;
const SVG_3Q = 199;

function split(qubits: number, svgHeight: number, rail: number, chip: number, railWidth = 316) {
  const { min } = blochRailHeights(qubits, railWidth);
  return planRailSplit({
    railHeight: rail,
    chipHeight: chip,
    circuitWanted: circuitWantedHeight(svgHeight),
    circuitFloor: Math.max(96, circuitMinHeight(qubits, rail)),
    blochMin: min,
  });
}

describe('planRailSplit', () => {
  it('shows all six wires and the register of a 6-qubit circuit at 1440x900 (was clipped at 40vh with 79px empty)', () => {
    const plan = split(6, SVG_6Q, 876, 100);
    expect(plan.circuit).toBe(circuitWantedHeight(SVG_6Q));
    expect(plan.circuit).toBeGreaterThanOrEqual(40 + 365);
    expect(plan.circuit + plan.bloch + 100).toBe(876);
  });

  it('gives a 3-qubit circuit its register at 900x700', () => {
    const plan = split(3, SVG_3Q, 676, 100);
    expect(plan.circuit).toBe(circuitWantedHeight(SVG_3Q));
    expect(plan.circuit + plan.bloch + 100).toBe(676);
  });

  it('lets a 5-qubit circuit yield to the spheres at 900x700 with the terminal open', () => {
    const rail = 380;
    const { min } = blochRailHeights(5, 316);
    const plan = split(5, SVG_5Q, rail, 0);
    expect(plan.bloch).toBeGreaterThanOrEqual(min);
    expect(plan.circuit).toBeLessThanOrEqual(rail - min);
    expect(plan.circuit + plan.bloch).toBe(rail);
  });

  it('hands every spare pixel to the spheres, so nothing is left as dead space', () => {
    const plan = split(1, 100, 876, 100);
    expect(plan.circuit + plan.bloch).toBe(776);
  });

  it('never goes below the floors even when they cannot both fit (the rail then scrolls)', () => {
    const { min } = blochRailHeights(5, 316);
    const plan = split(5, SVG_5Q, 200, 100);
    expect(plan.bloch).toBe(min);
    expect(plan.circuit).toBeGreaterThanOrEqual(96);
  });

  it('falls back to the wanted height before the rail is measured', () => {
    expect(planRailSplit({ railHeight: 0, chipHeight: 0, circuitWanted: 300, circuitFloor: 96, blochMin: 164 }).circuit).toBe(300);
  });
});
