// components/davos/BindButton.tsx
// Canonical component for Object: Oath bind action (PRD §7.4, §11, §12; BREADBOARD F4; design/DESIGN.md §6).
// Props: delay, onBind
// States: disabled, enabled, error
// Enforces 5s delay and online-only connectivity (PRD §7.4, §11).
// Accent color appears on Bind button (PRD §12 accent rule).
// Uses only theme/roles.ts. Touch target >= 44dp.

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  colorRoles,
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';

export interface BindButtonProps {
  delay?: number; // 5 seconds by default per PRD §7.4
  onBind: () => void;
  state?: 'disabled' | 'enabled' | 'error';
  isBinding?: boolean;
  isOffline?: boolean;
  errorMessage?: string;
  colorScheme?: 'light' | 'dark';
}

export function BindButton({
  delay = 5,
  onBind,
  state: propState,
  isBinding = false,
  isOffline = false,
  errorMessage = 'Not bound. Nothing was saved. Try again.',
  colorScheme = 'light',
}: BindButtonProps) {
  const colors = colorRoles[colorScheme];
  const [secondsRemaining, setSecondsRemaining] = useState<number>(delay);

  useEffect(() => {
    if (propState !== undefined) return;
    if (secondsRemaining <= 0) return;

    const timer = setTimeout(() => {
      setSecondsRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearTimeout(timer);
  }, [secondsRemaining, propState]);

  // Determine active state
  const derivedState: 'disabled' | 'enabled' | 'error' =
    propState !== undefined
      ? propState
      : isOffline || secondsRemaining > 0 || isBinding
      ? 'disabled'
      : 'enabled';

  // State: error (PRD §11 copy: "Not bound. Nothing was saved. Try again.")
  if (derivedState === 'error') {
    return (
      <View style={styles.errorContainer}>
        <Text
          style={[styles.errorText, typeRoles.meta, { color: colors.danger }]}
          allowFontScaling={true}>
          {errorMessage}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry binding Oath"
          hitSlop={touchTarget.hitSlop}
          style={[styles.button, { borderColor: colors.danger }]}
          onPress={onBind}>
          <Text
            style={[styles.buttonText, typeRoles.heading, { color: colors.danger }]}
            allowFontScaling={true}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }

  // States: disabled & enabled
  const isEnabled = derivedState === 'enabled';

  return (
    <View style={styles.container}>
      {isOffline && (
        <Text
          style={[styles.offlineNotice, typeRoles.meta, { color: colors.textSecondary }]}
          allowFontScaling={true}>
          Needs a connection.
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          isEnabled
            ? 'Bind Oath'
            : secondsRemaining > 0
            ? `Bind Oath disabled (${secondsRemaining}s delay)`
            : 'Bind Oath disabled (Needs a connection)'
        }
        disabled={!isEnabled}
        hitSlop={touchTarget.hitSlop}
        style={[
          styles.button,
          {
            borderColor: isEnabled ? colors.accent : colors.divider,
            backgroundColor: isEnabled ? colors.accent : colors.surface,
          },
        ]}
        onPress={onBind}>
        <Text
          style={[
            styles.buttonText,
            typeRoles.heading,
            { color: isEnabled ? colors.onAccent : colors.disabled },
          ]}
          allowFontScaling={true}>
          {isBinding
            ? 'Binding...'
            : secondsRemaining > 0 && !propState
            ? `Bind (${secondsRemaining}s)`
            : isOffline
            ? 'Needs connection'
            : 'Bind'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xxs,
    alignItems: 'flex-start',
  },
  errorContainer: {
    gap: spacing.xs,
    alignItems: 'flex-start',
  },
  errorText: {
    paddingHorizontal: spacing.none,
  },
  offlineNotice: {
    paddingHorizontal: spacing.none,
  },
  button: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  buttonText: {
    paddingHorizontal: spacing.none,
  },
});
