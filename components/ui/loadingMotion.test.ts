// components/ui/loadingMotion.test.ts
// Structural checks on the brand wait-state geometry. The renderer trusts these numbers, so a
// wrong radius or a frame that clips the orbit has to fail here rather than ship as a glitch.

import { MARK_ART } from '../brand/brandArtwork';
import {
  LOADING_DOT_ORBIT,
  LOADING_DOT_VIEW,
  LOADING_MARK_ORBIT,
  LOADING_MARK_VIEW,
  REDUCE_MOTION_PULSE,
  orbitBounds,
  orbitPoint,
} from './loadingMotion';

describe('loading motion', () => {
  it('orbits the main dot around the mark’s own centre', () => {
    expect(LOADING_MARK_ORBIT.centerX).toBe(MARK_ART.centerX);
    expect(LOADING_MARK_ORBIT.centerY).toBe(MARK_ART.centerY);
    expect(LOADING_MARK_ORBIT.periodMs).toBe(2400);
    expect(LOADING_MARK_ORBIT.dotRadius).toBeLessThan(MARK_ART.width / 4);
    expect(LOADING_MARK_ORBIT.startAngleDeg).toBe(180);
  });

  it('starts on the dot’s left bearing, the side of the static mark’s circle', () => {
    for (const orbit of [LOADING_MARK_ORBIT, LOADING_DOT_ORBIT]) {
      const first = orbitPoint(orbit, 0);
      expect(first.x).toBeLessThan(orbit.centerX);
      expect(first.y).toBeCloseTo(orbit.centerY, 10);
    }
  });

  it('keeps the main orbit inside its frame', () => {
    const bounds = orbitBounds(LOADING_MARK_ORBIT);
    expect(bounds.minX).toBeGreaterThan(0);
    expect(bounds.minY).toBeGreaterThan(0);
    expect(bounds.maxX).toBeLessThan(LOADING_MARK_VIEW);
    expect(bounds.maxY).toBeLessThan(LOADING_MARK_VIEW);
  });

  it('keeps the secondary orbit inside its frame', () => {
    const bounds = orbitBounds(LOADING_DOT_ORBIT);
    expect(bounds.minX).toBeGreaterThan(0);
    expect(bounds.minY).toBeGreaterThan(0);
    expect(bounds.maxX).toBeLessThan(LOADING_DOT_VIEW);
    expect(bounds.maxY).toBeLessThan(LOADING_DOT_VIEW);
    expect(LOADING_DOT_ORBIT.periodMs).toBe(900);
  });

  it('closes the loop: one full revolution returns to the starting bearing', () => {
    for (const orbit of [LOADING_MARK_ORBIT, LOADING_DOT_ORBIT]) {
      const start = orbitPoint(orbit, 0);
      const end = orbitPoint(orbit, 1);
      expect(end.x).toBeCloseTo(start.x, 10);
      expect(end.y).toBeCloseTo(start.y, 10);
    }
  });

  it('holds the orbit radius at every bearing', () => {
    for (const orbit of [LOADING_MARK_ORBIT, LOADING_DOT_ORBIT]) {
      for (const progress of [0, 0.125, 0.25, 0.5, 0.75, 0.9]) {
        const point = orbitPoint(orbit, progress);
        const distance = Math.hypot(point.x - orbit.centerX, point.y - orbit.centerY);
        expect(distance).toBeCloseTo(orbit.radius, 10);
      }
    }
  });

  it('describes a calm Reduce Motion pulse', () => {
    expect(REDUCE_MOTION_PULSE.periodMs).toBe(1600);
    expect(REDUCE_MOTION_PULSE.minOpacity).toBe(0.55);
  });
});
