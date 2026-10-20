import { describe, it, expect } from 'vitest';
import { DEFAULT_ORBIT_POSE, MAX_ORBIT_RADIUS, MIN_ORBIT_RADIUS, decayVelocity, dragPose, orbitPosition, zoomPose } from './blochOrbit';

describe('orbit math', () => {
  it('places the camera at the requested radius', () => {
    const [x, y, z] = orbitPosition(DEFAULT_ORBIT_POSE);
    expect(Math.hypot(x, y, z)).toBeCloseTo(DEFAULT_ORBIT_POSE.radius, 6);
    expect(y).toBeGreaterThan(0); // above the equator so |0> reads as up
  });

  it('dragging right and left rotates the azimuth in opposite directions', () => {
    const right = dragPose(DEFAULT_ORBIT_POSE, 40, 0, 200);
    const left = dragPose(DEFAULT_ORBIT_POSE, -40, 0, 200);
    expect(right.azimuth).toBeLessThan(DEFAULT_ORBIT_POSE.azimuth);
    expect(left.azimuth).toBeGreaterThan(DEFAULT_ORBIT_POSE.azimuth);
  });

  it('never flips over the poles', () => {
    expect(dragPose(DEFAULT_ORBIT_POSE, 0, 100000, 200).polar).toBeGreaterThan(0);
    expect(dragPose(DEFAULT_ORBIT_POSE, 0, -100000, 200).polar).toBeLessThan(Math.PI);
    expect(dragPose(DEFAULT_ORBIT_POSE, 0, -100000, 200).polar).toBeGreaterThan(0);
  });

  it('clamps zoom', () => {
    expect(zoomPose(DEFAULT_ORBIT_POSE, 1e6).radius).toBe(MAX_ORBIT_RADIUS);
    expect(zoomPose(DEFAULT_ORBIT_POSE, -1e6).radius).toBe(MIN_ORBIT_RADIUS);
  });

  it('coasts to a stop', () => {
    let v = 3;
    for (let i = 0; i < 120; i++) v = decayVelocity(v, 1 / 60);
    expect(v).toBe(0);
  });

  it('does not mutate its input', () => {
    const frozen = Object.freeze({ ...DEFAULT_ORBIT_POSE });
    expect(() => dragPose(frozen, 10, 10, 100)).not.toThrow();
  });
});
