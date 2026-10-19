// components/ui/LoadingMark.tsx
//
// The brand loading mark: "The Stern Face" assembling itself, used everywhere the app
// reports that it is waiting. It replaces `ActivityIndicator` — same role, same places, but
// the wait is now the brand rather than a system spinner.
//
// Artwork of record: `assets/new-branding-assets/loading_anim_dark.svg` (dark mark, for light
// surfaces) and `loading_anim_light.svg` (cream mark, for dark surfaces). The two files differ
// only in the mark colour, so this one component owns both: the fill comes from the theme's
// scheme, exactly as the two files do. All motion data lives in `loadingMarkTimeline.ts`.
//
// Reduce Motion: no part travels. The assembled face holds still and pulses, which is the
// intent behind the artwork's `prefers-reduced-motion` branch.

import React, { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import { useTheme } from '../../theme';
import {
  ART_HEIGHT,
  ART_WIDTH,
  CHANNELS,
  CHANNEL_NAMES,
  EASE_IN_OUT,
  ORIGIN,
  PULSE_MIN_OPACITY,
  PULSE_MS,
  REST_VALUES,
  segments,
  startValue,
  type ChannelName,
  type KeyframeEasing,
  type MarkKeyframe,
} from './loadingMarkTimeline';

const AnimatedG = Animated.createAnimatedComponent(G);

/** Brand ink pair (TECH-SPECS §9): the mark is fixed by the artwork, not OKLCH-derived. */
const BRAND_INK = {
  onLight: '#1a1a1a',
  onDark: '#ede8dd',
} as const;

/** Path data verbatim from the supplied SVGs (cap on top, as in the artwork). */
const PART_PATHS = {
  mus: 'm136 396 92 22 73-44 35 21 35-20 72 43 93-22-114 95-86-69-87 69z',
  nose: 'M345 308h135l-69 54z',
  cap: 'm192 244 271-66 17 68-271 68z',
} as const;

/**
 * Frame sizes in dp. The mark is 313 of the artwork's 669 units tall, so it occupies about
 * the middle half of the frame — the rest is the room the parts travel through.
 */
const SIZE_PRESETS = {
  small: 24,
  large: 72,
} as const;

export type LoadingMarkSize = keyof typeof SIZE_PRESETS | number;

export interface LoadingMarkProps {
  size?: LoadingMarkSize;
  /** Fill for the mark. Defaults to the brand ink for the current scheme. */
  color?: string;
  /** Announced when the mark is the loading indicator. Defaults to "Loading". */
  label?: string;
  /**
   * Hide the mark from assistive tech when the surrounding control already announces its
   * busy state (`accessibilityState.busy`), so it is not read twice.
   */
  decorative?: boolean;
  style?: StyleProp<ViewStyle>;
}

function toEasing(easing: KeyframeEasing) {
  return easing === 'linear' ? Easing.linear : Easing.bezier(...easing);
}

/** One channel of the cycle, as a chain of timed segments. */
function channelAnimation(
  value: Animated.Value,
  frames: readonly MarkKeyframe[]
): Animated.CompositeAnimation {
  return Animated.sequence(
    segments(frames).map((segment) =>
      Animated.timing(value, {
        toValue: segment.toValue,
        duration: segment.durationMs,
        easing: toEasing(segment.easing),
        // The values drive react-native-svg group transforms, which are props rather than
        // view transforms, so they must be applied on the JS side.
        useNativeDriver: false,
      })
    )
  );
}

function makeChannelValues(): Record<ChannelName, Animated.Value> {
  const values = {} as Record<ChannelName, Animated.Value>;
  for (const name of CHANNEL_NAMES) {
    values[name] = new Animated.Value(startValue(CHANNELS[name]));
  }
  return values;
}

export function LoadingMark({
  size = 'small',
  color,
  label = 'Loading',
  decorative = false,
  style,
}: LoadingMarkProps) {
  const { isDark } = useTheme();
  const [reduceMotion, setReduceMotion] = useState(false);

  const frame = typeof size === 'number' ? size : SIZE_PRESETS[size];
  const width = (frame * ART_WIDTH) / ART_HEIGHT;
  const ink = color ?? (isDark ? BRAND_INK.onDark : BRAND_INK.onLight);

  const values = useMemo(makeChannelValues, []);
  const faceOpacity = useMemo(() => new Animated.Value(1), []);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let animation: Animated.CompositeAnimation;

    if (reduceMotion) {
      for (const name of CHANNEL_NAMES) {
        values[name].setValue(REST_VALUES[name]);
      }
      faceOpacity.setValue(1);
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(faceOpacity, {
            toValue: PULSE_MIN_OPACITY,
            duration: PULSE_MS / 2,
            easing: toEasing(EASE_IN_OUT),
            useNativeDriver: false,
          }),
          Animated.timing(faceOpacity, {
            toValue: 1,
            duration: PULSE_MS / 2,
            easing: toEasing(EASE_IN_OUT),
            useNativeDriver: false,
          }),
        ])
      );
    } else {
      // Restart from the cycle's opening pose so a mid-cycle toggle does not sew two
      // unrelated positions together.
      faceOpacity.setValue(1);
      for (const name of CHANNEL_NAMES) {
        values[name].setValue(startValue(CHANNELS[name]));
      }
      animation = Animated.loop(
        Animated.parallel(CHANNEL_NAMES.map((name) => channelAnimation(values[name], CHANNELS[name])))
      );
    }

    animation.start();
    return () => animation.stop();
  }, [reduceMotion, values, faceOpacity]);

  return (
    <View
      style={[styles.container, { width, height: frame }, style]}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'progressbar'}
      accessibilityLabel={decorative ? undefined : label}
      accessibilityState={decorative ? undefined : { busy: true }}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: faceOpacity }]}>
        <Svg width={width} height={frame} viewBox={`0 0 ${ART_WIDTH} ${ART_HEIGHT}`} accessible={false}>
          <AnimatedG
            y={values.musY}
            scaleX={values.musScaleX}
            scaleY={values.musScaleY}
            originX={ORIGIN.mus.x}
            originY={ORIGIN.mus.y}
            opacity={values.musOpacity}>
            <Path d={PART_PATHS.mus} fill={ink} />
          </AnimatedG>
          <AnimatedG y={values.noseY} opacity={values.noseOpacity}>
            <Path d={PART_PATHS.nose} fill={ink} />
          </AnimatedG>
          <AnimatedG
            y={values.capY}
            rotation={values.capRotation}
            originX={ORIGIN.cap.x}
            originY={ORIGIN.cap.y}
            opacity={values.capOpacity}>
            <Path d={PART_PATHS.cap} fill={ink} />
          </AnimatedG>
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
