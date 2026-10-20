// components/ui/LoadingDot.tsx
//
// The secondary brand wait state: one amber dot orbiting a small, invisible centre. It is the
// same motion as `LoadingMark` reduced to a control-sized frame, for button loadings and any
// inline "still working" signal where the full stem would be too heavy.
//
// Colours come from the caller (a filled button passes its on-colour); the dot keeps the
// brand amber only when that would contrast.
//
// Reduce Motion: the dot holds at the top of its orbit and pulses.

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
import Svg, { Circle, G } from 'react-native-svg';
import { useTheme } from '../../theme';
import { LOADING_DOT_ORBIT, LOADING_DOT_VIEW, REDUCE_MOTION_PULSE } from './loadingMotion';

const AnimatedG = Animated.createAnimatedComponent(G);

export interface LoadingDotProps {
  /** Frame edge in dp. The dot sweeps inside roughly three-quarters of it. */
  size?: number;
  color?: string;
  label?: string;
  decorative?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function LoadingDot({
  size = 18,
  color,
  label = 'Loading',
  decorative = false,
  style,
}: LoadingDotProps) {
  const { colors } = useTheme();
  const [reduceMotion, setReduceMotion] = useState(false);
  const ink = color ?? colors.textSecondary;

  const rotation = useMemo(() => new Animated.Value(0), []);
  const opacity = useMemo(() => new Animated.Value(1), []);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let animation: Animated.CompositeAnimation;

    if (reduceMotion) {
      opacity.setValue(1);
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: REDUCE_MOTION_PULSE.minOpacity,
            duration: REDUCE_MOTION_PULSE.periodMs / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: REDUCE_MOTION_PULSE.periodMs / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ])
      );
    } else {
      rotation.setValue(LOADING_DOT_ORBIT.startAngleDeg);
      animation = Animated.loop(
        Animated.timing(rotation, {
          toValue: LOADING_DOT_ORBIT.startAngleDeg + 360,
          duration: LOADING_DOT_ORBIT.periodMs,
          easing: Easing.linear,
          useNativeDriver: false,
        })
      );
    }

    animation.start();
    return () => animation.stop();
  }, [reduceMotion, rotation, opacity]);

  return (
    <View
      style={[styles.container, { width: size, height: size }, style]}
      accessible={decorative ? undefined : true}
      accessibilityRole={decorative ? undefined : 'progressbar'}
      accessibilityLabel={decorative ? undefined : label}
      accessibilityState={decorative ? undefined : { busy: true }}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'auto'}
    >
      <Animated.View style={{ opacity }}>
        <Svg
          width={size}
          height={size}
          viewBox={`0 0 ${LOADING_DOT_VIEW} ${LOADING_DOT_VIEW}`}
          accessible={undefined}
        >
          {reduceMotion ? (
            <Circle
              cx={LOADING_DOT_ORBIT.centerX}
              cy={LOADING_DOT_ORBIT.centerY - LOADING_DOT_ORBIT.radius}
              r={LOADING_DOT_ORBIT.dotRadius}
              fill={ink}
            />
          ) : (
            <G transform={`translate(${LOADING_DOT_ORBIT.centerX}, ${LOADING_DOT_ORBIT.centerY})`}>
              <AnimatedG rotation={rotation}>
                <G transform={`translate(${LOADING_DOT_ORBIT.radius}, 0)`}>
                  <Circle cx={0} cy={0} r={LOADING_DOT_ORBIT.dotRadius} fill={ink} />
                </G>
              </AnimatedG>
            </G>
          )}
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
