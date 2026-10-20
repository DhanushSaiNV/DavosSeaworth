// components/ui/LoadingMark.tsx
//
// The primary brand loading mark: the amber dot orbits the stem, passing behind it on
// every revolution. Used on full-screen gates and other large waits.
//
// Artwork of record: `assets/davos_logo/` (see `components/brand/brandArtwork.ts`).
// Motion data lives in `loadingMotion.ts` as pure, unit-tested geometry.
//
// Reduce Motion: the orbit is suppressed. The static mark holds still and pulses, so the wait
// still reads as alive without any travel.

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
import Svg, { Circle, G, Path } from 'react-native-svg';
import { useTheme } from '../../theme';
import {
  BRAND_AMBER,
  BRAND_NAVY,
  BRAND_PAPER,
  MARK_ART,
  MARK_STEM_PATH,
  MARK_VIEWBOX,
} from '../brand/brandArtwork';
import { BrandMark } from '../brand/BrandMark';
import {
  LOADING_MARK_ORBIT,
  LOADING_MARK_VIEW,
  REDUCE_MOTION_PULSE,
} from './loadingMotion';

const AnimatedG = Animated.createAnimatedComponent(G);

/**
 * Frame sizes in dp. The artwork's visible mark is about two-thirds of the frame, so the
 * mark reads at roughly half of `size` — the rest is the room the dot orbits through.
 */
const SIZE_PRESETS = {
  small: 24,
  large: 72,
} as const;

export type LoadingMarkSize = keyof typeof SIZE_PRESETS | number;

export interface LoadingMarkProps {
  size?: LoadingMarkSize;
  /** Single-colour override. Defaults to the brand pair for the current scheme. */
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
  const width = frame;

  const dotColor = color ?? BRAND_AMBER;
  const stemColor = color ?? (isDark ? BRAND_PAPER : BRAND_NAVY);

  const rotation = useMemo(() => new Animated.Value(0), []);
  const faceOpacity = useMemo(() => new Animated.Value(1), []);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let animation: Animated.CompositeAnimation;

    if (reduceMotion) {
      faceOpacity.setValue(1);
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(faceOpacity, {
            toValue: REDUCE_MOTION_PULSE.minOpacity,
            duration: REDUCE_MOTION_PULSE.periodMs / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(faceOpacity, {
            toValue: 1,
            duration: REDUCE_MOTION_PULSE.periodMs / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ])
      );
    } else {
      // A full turn starts and ends on the same bearing, so the loop restart is invisible.
      rotation.setValue(LOADING_MARK_ORBIT.startAngleDeg);
      animation = Animated.loop(
        Animated.timing(rotation, {
          toValue: LOADING_MARK_ORBIT.startAngleDeg + 360,
          duration: LOADING_MARK_ORBIT.periodMs,
          easing: Easing.linear,
          // The value drives a react-native-svg group rotation (a prop, not a view
          // transform), so it must be applied on the JS side.
          useNativeDriver: false,
        })
      );
    }

    animation.start();
    return () => animation.stop();
  }, [reduceMotion, rotation, faceOpacity]);

  const offsetX = MARK_VIEWBOX / 2 - MARK_ART.centerX;
  const offsetY = MARK_VIEWBOX / 2 - MARK_ART.centerY;

  return (
    <View
      style={[styles.container, { width, height: frame }, style]}
      accessible={decorative ? undefined : true}
      accessibilityRole={decorative ? undefined : 'progressbar'}
      accessibilityLabel={decorative ? undefined : label}
      accessibilityState={decorative ? undefined : { busy: true }}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
    >
      {reduceMotion ? (
        <Animated.View style={{ opacity: faceOpacity }}>
          <BrandMark size={frame} color={color} decorative />
        </Animated.View>
      ) : (
        <Svg
          width={width}
          height={frame}
          viewBox={`0 0 ${LOADING_MARK_VIEW} ${LOADING_MARK_VIEW}`}
          accessible={undefined}
        >
          {/*
            Pivots are composed as nested static translate groups rather than `originX`/
            `originY`: react-native-svg's web implementation emits those as a
            `transform-origin` prop, which React DOM rejects. Translate to the pivot, rotate,
            translate the dot out to the orbit radius.
          */}
          <G transform={`translate(${LOADING_MARK_ORBIT.centerX}, ${LOADING_MARK_ORBIT.centerY})`}>
            <AnimatedG rotation={rotation}>
              <G transform={`translate(${LOADING_MARK_ORBIT.radius}, 0)`}>
                <Circle cx={0} cy={0} r={LOADING_MARK_ORBIT.dotRadius} fill={dotColor} />
              </G>
            </AnimatedG>
          </G>
          {/* The stem is painted last, so the dot passes behind it. */}
          <G transform={`translate(${offsetX}, ${offsetY})`}>
            <Path d={MARK_STEM_PATH} fill={stemColor} fillRule="nonzero" />
          </G>
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
