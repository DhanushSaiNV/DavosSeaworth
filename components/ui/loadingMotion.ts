// components/ui/loadingMotion.ts
//
// Motion geometry for the two brand wait states. Pure data and pure helpers only — no React,
// no react-native — so the choreography is unit-testable and the components stay a thin
// mapping from these numbers onto Animated values.
//
// Both animations are built from the same idea: the mark's amber dot orbits the stem,
// passing behind it (the stem is painted after the dot, so z-order does the occlusion). The
// main mark uses the full stem; the secondary dot is the same orbit reduced to a spinner-sized
// frame for buttons and inline controls.

import { MARK_ART } from '../brand/brandArtwork';

export interface Orbit {
  centerX: number;
  centerY: number;
  radius: number;
  dotRadius: number;
  periodMs: number;
  /** Bearing of the dot at rest, in degrees (0 = right, 180 = left). */
  startAngleDeg: number;
}

/** Frame (viewBox edge) of the main loading mark. */
export const LOADING_MARK_VIEW = 120;

/**
 * Main orbit. The dot stays inside the 120-unit frame: the widest sweep is
 * 54 ± 36 ± 13 → 5…103 on x and 8.75…106.75 on y.
 */
export const LOADING_MARK_ORBIT: Orbit = {
  centerX: MARK_ART.centerX,
  centerY: MARK_ART.centerY,
  radius: 36,
  dotRadius: 13,
  periodMs: 2400,
  // Start left of the stem, the side the circle occupies in the static mark, so the first
  // frame reads as the logo rather than a dot hidden behind the stem.
  startAngleDeg: 180,
};

/** Frame (viewBox edge) of the secondary loading dot. */
export const LOADING_DOT_VIEW = 24;

/** Secondary orbit — one revolution per 0.9 s, sized for a 16–24 dp control. */
export const LOADING_DOT_ORBIT: Orbit = {
  centerX: 12,
  centerY: 12,
  radius: 7,
  dotRadius: 2.6,
  periodMs: 900,
  startAngleDeg: 180,
};

/** Reduce Motion: no travel; the static artwork pulses instead. */
export const REDUCE_MOTION_PULSE = { periodMs: 1600, minOpacity: 0.55 } as const;

/** Position of the orbiting dot at `progress` (0–1) of a revolution. */
export function orbitPoint(orbit: Orbit, progress: number): { x: number; y: number } {
  const angle = ((orbit.startAngleDeg + progress * 360) * Math.PI) / 180;
  return {
    x: orbit.centerX + orbit.radius * Math.cos(angle),
    y: orbit.centerY + orbit.radius * Math.sin(angle),
  };
}

/** Extents of the swept dot, dot radius included — the frame must contain these. */
export function orbitBounds(orbit: Orbit): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  return {
    minX: orbit.centerX - orbit.radius - orbit.dotRadius,
    maxX: orbit.centerX + orbit.radius + orbit.dotRadius,
    minY: orbit.centerY - orbit.radius - orbit.dotRadius,
    maxY: orbit.centerY + orbit.radius + orbit.dotRadius,
  };
}
