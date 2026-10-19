// components/ui/loadingMarkTimeline.ts
//
// The brand loading mark's motion, ported from the owner-supplied
// `assets/new-branding-assets/loading_anim_{dark,light}.svg`. Those two files are identical
// apart from the mark colour, so both collapse into one component fed by this one timeline.
//
// This module is pure data and pure helpers: no React, no react-native, no react-native-svg.
// That keeps the choreography unit-testable (loadingMarkTimeline.test.ts) while
// `LoadingMark.tsx` stays a thin mapping from these numbers onto Animated values.
//
// Conventions (matching the source CSS):
// - `at` is the fraction of one cycle (0–1), i.e. the CSS keyframe percentages.
// - `value` is in artwork user units (the SVG viewBox), so it is resolution-independent.
// - a keyframe's `easing` governs the segment that STARTS at it — CSS keyframe semantics,
//   not "the segment that arrives here".

/** Artwork viewBox, exactly as supplied. */
export const ART_WIDTH = 672;
export const ART_HEIGHT = 669;

/**
 * The visible mark inside the artwork. The surrounding margin is the fly-in envelope
 * (each part travels well outside this box while it is still at/near zero opacity), which is
 * why the frame is deliberately larger than the mark it shows.
 */
export const MARK_WIDTH = 400;
export const MARK_HEIGHT = 313;

/** One assembly cycle — the artwork's `--d`. */
export const CYCLE_MS = 2000;

/** Reduce Motion fallback: the assembled face pulses instead of travelling (`pulse 1.6s`). */
export const PULSE_MS = 1600;
export const PULSE_MIN_OPACITY = 0.55;

export type CubicBezier = readonly [x1: number, y1: number, x2: number, y2: number];
export type KeyframeEasing = CubicBezier | 'linear';

/** The artwork's three custom properties. */
export const EASE_OUT: CubicBezier = [0.34, 1.56, 0.64, 1]; // overshoots past the target
export const EASE_IN: CubicBezier = [0.6, -0.28, 0.74, 0.05]; // anticipates, pulls back first
export const EASE_IO: CubicBezier = [0.4, 0, 0.2, 1];
export const EASE_IN_OUT: CubicBezier = [0.42, 0, 0.58, 1]; // CSS `ease-in-out` (the pulse)

export interface MarkKeyframe {
  /** Cycle fraction, 0–1. */
  at: number;
  /** Artwork units for a transform channel, 0–1 for an opacity channel. */
  value: number;
  easing?: KeyframeEasing;
}

export type ChannelName =
  | 'capY'
  | 'capRotation'
  | 'capOpacity'
  | 'noseY'
  | 'noseOpacity'
  | 'musY'
  | 'musScaleX'
  | 'musScaleY'
  | 'musOpacity';

/**
 * Each channel is one independent keyframe list. The parts assemble bottom-up — moustache,
 * then nose, then cap — hold, glance, and then leave in the same order, so the face is
 * empty at the start and end of every cycle.
 *
 * Note the artwork's deliberate asymmetry: the nose finishes 10 units above its start and the
 * moustache 10 units below its. That is invisible (both are fully transparent at that point)
 * and is preserved rather than "corrected" into a seamless loop.
 */
export const CHANNELS: Record<ChannelName, readonly MarkKeyframe[]> = {
  // Cap (brow bar) — `transform-origin: 200px 279px`, `@keyframes cap`.
  capY: [
    { at: 0, value: -40 },
    { at: 0.18, value: -40, easing: EASE_OUT },
    { at: 0.34, value: 0 },
    { at: 0.42, value: 0, easing: EASE_IO },
    { at: 0.52, value: -8 },
    { at: 0.56, value: -8, easing: EASE_OUT },
    { at: 0.66, value: 0 },
    { at: 0.72, value: 0, easing: EASE_IN },
    { at: 0.86, value: -40 },
    { at: 1, value: -40 },
  ],
  capRotation: [
    { at: 0, value: -26 },
    { at: 0.18, value: -26, easing: EASE_OUT },
    { at: 0.34, value: 0 },
    { at: 0.42, value: 0, easing: EASE_IO },
    { at: 0.52, value: -16 },
    { at: 0.56, value: -16, easing: EASE_OUT },
    { at: 0.66, value: 0 },
    { at: 0.72, value: 0, easing: EASE_IN },
    { at: 0.86, value: -26 },
    { at: 1, value: -26 },
  ],
  capOpacity: [
    { at: 0, value: 0 },
    { at: 0.18, value: 0 },
    { at: 0.24, value: 1 },
    { at: 0.72, value: 1 },
    { at: 0.86, value: 0 },
    { at: 1, value: 0 },
  ],

  // Nose — pure vertical travel, no pivot, `@keyframes nose`.
  noseY: [
    { at: 0, value: -80 },
    { at: 0.08, value: -80, easing: EASE_OUT },
    { at: 0.22, value: 0 },
    { at: 0.5, value: 0, easing: EASE_IO },
    { at: 0.53, value: 4, easing: EASE_IO },
    { at: 0.58, value: 0 },
    { at: 0.76, value: 0, easing: EASE_IN },
    { at: 0.9, value: -70 },
    { at: 1, value: -70 },
  ],
  noseOpacity: [
    { at: 0, value: 0 },
    { at: 0.08, value: 0 },
    { at: 0.14, value: 1 },
    { at: 0.76, value: 1 },
    { at: 0.9, value: 0 },
    { at: 1, value: 0 },
  ],

  // Moustache — travel plus a squash/stretch, `transform-origin: 336px 433px`, `@keyframes mus`.
  musY: [
    { at: 0, value: 80 },
    { at: 0.14, value: 0 },
    { at: 0.48, value: 0, easing: EASE_IO },
    { at: 0.51, value: 3, easing: EASE_IO },
    { at: 0.55, value: -3, easing: EASE_IO },
    { at: 0.58, value: 0 },
    { at: 0.8, value: 0, easing: EASE_IN },
    { at: 0.94, value: 70 },
    { at: 1, value: 70 },
  ],
  musScaleX: [
    { at: 0, value: 1 },
    { at: 0.14, value: 1 },
    { at: 0.48, value: 1, easing: EASE_IO },
    { at: 0.51, value: 1.04, easing: EASE_IO },
    { at: 0.55, value: 0.98, easing: EASE_IO },
    { at: 0.58, value: 1 },
    { at: 0.8, value: 1 },
    { at: 0.94, value: 1 },
    { at: 1, value: 1 },
  ],
  musScaleY: [
    { at: 0, value: 1 },
    { at: 0.14, value: 1 },
    { at: 0.48, value: 1, easing: EASE_IO },
    { at: 0.51, value: 0.9, easing: EASE_IO },
    { at: 0.55, value: 1.05, easing: EASE_IO },
    { at: 0.58, value: 1 },
    { at: 0.8, value: 1 },
    { at: 0.94, value: 1 },
    { at: 1, value: 1 },
  ],
  musOpacity: [
    { at: 0, value: 0 },
    { at: 0.06, value: 1 },
    { at: 0.8, value: 1 },
    { at: 0.94, value: 0 },
    { at: 1, value: 0 },
  ],
};

export const CHANNEL_NAMES = Object.keys(CHANNELS) as ChannelName[];

/** Rotation/scale pivots in artwork units — the CSS `transform-origin` declarations. */
export const ORIGIN = {
  cap: { x: 200, y: 279 },
  mus: { x: 336, y: 433 },
} as const;

/**
 * Where every channel sits when travel is suppressed (Reduce Motion): the fully assembled
 * face, fully opaque. The CSS merely switches `.face` to a pulse, which would leave the
 * per-part opacity keyframes running; holding the assembled pose is the intent behind it.
 */
export const REST_VALUES: Record<ChannelName, number> = {
  capY: 0,
  capRotation: 0,
  capOpacity: 1,
  noseY: 0,
  noseOpacity: 1,
  musY: 0,
  musScaleX: 1,
  musScaleY: 1,
  musOpacity: 1,
};

/** Value of a channel at the start of a cycle (its 0 % keyframe). */
export function startValue(frames: readonly MarkKeyframe[]): number {
  return frames[0].value;
}

/** Easing for the segment that begins at `frames[index]`. */
export function segmentEasing(frames: readonly MarkKeyframe[], index: number): KeyframeEasing {
  return frames[index].easing ?? 'linear';
}

/** Every segment of a cycle, in order — `{ durationMs, toValue, easing }`. */
export function segments(frames: readonly MarkKeyframe[]): {
  durationMs: number;
  toValue: number;
  easing: KeyframeEasing;
}[] {
  return frames.slice(1).map((frame, index) => ({
    durationMs: Math.round((frame.at - frames[index].at) * CYCLE_MS),
    toValue: frame.value,
    easing: segmentEasing(frames, index),
  }));
}
