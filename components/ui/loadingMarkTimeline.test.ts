// components/ui/loadingMarkTimeline.test.ts
// Structural checks on the ported loading-mark choreography. These guard the transcription
// against the source SVG: the renderer trusts the data, so a wrong keyframe (an offset out of
// order, a gap, a lost segment) has to fail here rather than show up as a visual glitch.

import {
  CHANNELS,
  CHANNEL_NAMES,
  CYCLE_MS,
  EASE_IN,
  EASE_IN_OUT,
  EASE_IO,
  EASE_OUT,
  MARK_HEIGHT,
  MARK_WIDTH,
  ORIGIN,
  PULSE_MIN_OPACITY,
  PULSE_MS,
  REST_VALUES,
  segments,
  startValue,
  type ChannelName,
  type MarkKeyframe,
} from './loadingMarkTimeline';

function valueAt(frames: readonly MarkKeyframe[], at: number): number | undefined {
  return frames.find((frame) => frame.at === at)?.value;
}

describe('loading mark timeline', () => {
  it('keeps the artwork proportions and cycle constants', () => {
    expect(MARK_WIDTH).toBe(400);
    expect(MARK_HEIGHT).toBe(313);
    expect(CYCLE_MS).toBe(2000);
    expect(PULSE_MS).toBe(1600);
    expect(PULSE_MIN_OPACITY).toBe(0.55);
    expect(ORIGIN.cap).toEqual({ x: 200, y: 279 });
    expect(ORIGIN.mus).toEqual({ x: 336, y: 433 });
  });

  it('has a channel for every animated property, all starting at 0 and ending at 1', () => {
    expect(CHANNEL_NAMES).toHaveLength(9);
    expect(CHANNEL_NAMES.slice().sort()).toEqual(Object.keys(REST_VALUES).slice().sort());

    for (const name of CHANNEL_NAMES) {
      const frames = CHANNELS[name];
      expect(frames.length).toBeGreaterThan(1);
      expect(frames[0].at).toBe(0);
      expect(frames[frames.length - 1].at).toBe(1);
    }
  });

  it('keeps every channel monotonic in time with no empty segment', () => {
    for (const name of CHANNEL_NAMES) {
      const frames = CHANNELS[name];
      for (let i = 0; i < frames.length; i++) {
        expect(Number.isFinite(frames[i].value)).toBe(true);
        expect(frames[i].at).toBeGreaterThanOrEqual(0);
        expect(frames[i].at).toBeLessThanOrEqual(1);
        if (i > 0) {
          expect(frames[i].at).toBeGreaterThan(frames[i - 1].at);
        }
      }

      const parts = segments(frames);
      expect(parts).toHaveLength(frames.length - 1);
      for (const part of parts) {
        expect(part.durationMs).toBeGreaterThan(0);
      }
      expect(parts.reduce((total, part) => total + part.durationMs, 0)).toBe(CYCLE_MS);
    }
  });

  it('only uses the artwork’s cubic-bezier curves, with x in range as CSS requires', () => {
    const allowed = new Set([EASE_OUT, EASE_IN, EASE_IO, EASE_IN_OUT]);

    for (const name of CHANNEL_NAMES) {
      for (const frame of CHANNELS[name]) {
        if (frame.easing === undefined || frame.easing === 'linear') continue;
        expect(allowed.has(frame.easing)).toBe(true);
        expect(frame.easing[0]).toBeGreaterThanOrEqual(0);
        expect(frame.easing[0]).toBeLessThanOrEqual(1);
        expect(frame.easing[2]).toBeGreaterThanOrEqual(0);
        expect(frame.easing[2]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('assembles bottom-up — moustache, then nose, then cap', () => {
    // Each part reaches its resting transform at its own landing beat, in that order.
    expect(valueAt(CHANNELS.musY, 0.14)).toBe(0);
    expect(valueAt(CHANNELS.noseY, 0.22)).toBe(0);
    expect(valueAt(CHANNELS.capY, 0.34)).toBe(0);
    expect(valueAt(CHANNELS.capRotation, 0.34)).toBe(0);
  });

  it('leaves the face empty at both ends of the cycle', () => {
    // Every part is invisible at 0 and at 1, so the loop restart is never seen — which also
    // covers the deliberate asymmetry below.
    for (const name of ['capOpacity', 'noseOpacity', 'musOpacity'] as ChannelName[]) {
      expect(CHANNELS[name][0].value).toBe(0);
      expect(CHANNELS[name][CHANNELS[name].length - 1].value).toBe(0);
    }

    // The cap is seamless (it returns to its 0 % offset and angle).
    expect(CHANNELS.capY[CHANNELS.capY.length - 1].value).toBe(startValue(CHANNELS.capY));
    expect(CHANNELS.capRotation[CHANNELS.capRotation.length - 1].value).toBe(
      startValue(CHANNELS.capRotation)
    );

    // The nose and moustache end 10 units short of where they started — the artwork's own
    // choice, and invisible because both are fully transparent at 1. Asserted so a later
    // "fix" that makes them symmetric is a deliberate decision rather than a silent change.
    expect(CHANNELS.noseY[CHANNELS.noseY.length - 1].value).toBe(-70);
    expect(startValue(CHANNELS.noseY)).toBe(-80);
    expect(CHANNELS.musY[CHANNELS.musY.length - 1].value).toBe(70);
    expect(startValue(CHANNELS.musY)).toBe(80);
  });

  it('describes the assembled pose for Reduce Motion', () => {
    expect(REST_VALUES.capY).toBe(0);
    expect(REST_VALUES.capRotation).toBe(0);
    expect(REST_VALUES.noseY).toBe(0);
    expect(REST_VALUES.musY).toBe(0);
    expect(REST_VALUES.musScaleX).toBe(1);
    expect(REST_VALUES.musScaleY).toBe(1);
    expect(REST_VALUES.capOpacity).toBe(1);
    expect(REST_VALUES.noseOpacity).toBe(1);
    expect(REST_VALUES.musOpacity).toBe(1);
  });
});
