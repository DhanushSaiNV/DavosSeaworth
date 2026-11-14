// components/davos/Toast.tsx
// Floating notification pill for user actions (Blueprint & Redesign mockup).
// RN primitives only, tokens via useTheme. Smooth animated translation and fade.

import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useTheme } from '../../theme';
import { radius, spacing, typeRoles } from '../../theme/roles';
import { hapticImpactLight } from '../../lib/haptics';

export interface ToastProps {
  message: string | null;
  visible: boolean;
}

export function Toast({ message, visible }: ToastProps) {
  const { colors } = useTheme();
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(12)).current;
  const [rendered, setRendered] = useState(visible);

  useEffect(() => {
    if (visible && message) {
      setRendered(true);
      void hapticImpactLight();
      Animated.parallel([
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(translateYAnim, {
          toValue: 0,
          damping: 18,
          stiffness: 220,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(translateYAnim, {
          toValue: 8,
          duration: 160,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          setRendered(false);
        }
      });
    }
  }, [visible, message, opacityAnim, translateYAnim]);

  if (!rendered || !message) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: colors.border,
          opacity: opacityAnim,
          transform: [{ translateY: translateYAnim }],
        },
      ]}
      pointerEvents="none"
      accessibilityLiveRegion="polite">
      <Text
        style={[
          styles.text,
          typeRoles.meta,
          { color: colors.textPrimary },
        ]}
        allowFontScaling={true}>
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    zIndex: 999,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.sm,
    maxWidth: '90%',
    shadowOpacity: 0,
    elevation: 0,
  },
  text: {
    fontSize: 11,
    textAlign: 'center',
  },
});
