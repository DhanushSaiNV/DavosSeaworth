// components/davos/UndoToast.tsx
// Canonical component for Object: Doing undo control (PRD §3, §7.1, §11, §12; BREADBOARD F1).
// Props: label, timeout (default 10s)
// States: visible
// Hairline divider, plain unboxed layout, no cards, no elevation.
// Uses only theme/roles.ts. Touch target >= 44dp.

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import {
  spacing,
  touchTarget,
  typeRoles,
} from '../../theme/roles';

export interface UndoToastProps {
  label: string;
  timeout?: number; // Duration in seconds, default 10 per BREADBOARD F1
  onUndo: () => void;
  onExpire?: () => void;
  colorScheme?: 'light' | 'dark';
}

export function UndoToast({
  label,
  timeout = 10,
  onUndo,
  onExpire,
  colorScheme,
}: UndoToastProps) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(timeout);
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  useEffect(() => {
    if (secondsRemaining <= 0) {
      onExpire?.();
      return;
    }

    const timer = setTimeout(() => {
      setSecondsRemaining((prev) => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [secondsRemaining, onExpire]);

  if (secondsRemaining <= 0) {
    return null;
  }

  return (
    <View style={[styles.container, { borderBottomColor: colors.divider }]}>
      {/* Label and remaining seconds */}
      <Text
        style={[styles.labelText, typeRoles.meta, { color: colors.textPrimary }]}
        allowFontScaling={true}>
        {label} ({secondsRemaining}s)
      </Text>

      {/* Undo action button */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Undo check-in log"
        hitSlop={touchTarget.hitSlop}
        style={[styles.undoButton, { borderColor: colors.divider }]}
        onPress={onUndo}>
        <Text
          style={[
            styles.undoText,
            typeRoles.davosVoice,
            { color: colors.textPrimary, fontWeight: '500' },
          ]}
          allowFontScaling={true}>
          Undo
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  labelText: {
    flex: 1,
    paddingHorizontal: spacing.none,
  },
  undoButton: {
    minHeight: touchTarget.minTargetIos,
    minWidth: touchTarget.minTargetIos,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  undoText: {
    paddingHorizontal: spacing.none,
  },
});
