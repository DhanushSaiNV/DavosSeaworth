// components/davos/Toast.tsx
// Floating notification pill for user actions (Blueprint & Redesign mockup).
// RN primitives only, tokens via useTheme.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { radius, spacing, typeRoles } from '../../theme/roles';

export interface ToastProps {
  message: string | null;
  visible: boolean;
}

export function Toast({ message, visible }: ToastProps) {
  const { colors } = useTheme();

  if (!visible || !message) return null;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: colors.border,
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
    </View>
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
