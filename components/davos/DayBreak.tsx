// components/davos/DayBreak.tsx
// Canonical day break separator (multi-day threads only per Blueprint §2.2).
// Meta 12/16/500 textTertiary, marginTop: lg, one hairline across.
// RN primitives only.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { spacing, typeRoles } from '../../theme/roles';

export interface DayBreakProps {
  label: string;
}

export function DayBreak({ label }: DayBreakProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <View style={[styles.line, { backgroundColor: colors.divider }]} />
      <Text
        style={[styles.label, typeRoles.meta, { color: colors.textTertiary }]}
        allowFontScaling={true}>
        {label}
      </Text>
      <View style={[styles.line, { backgroundColor: colors.divider }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
    width: '100%',
    gap: spacing.sm,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  label: {
    paddingHorizontal: spacing.none,
  },
});
