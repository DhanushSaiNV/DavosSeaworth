// components/davos/SettingsRow.tsx
// Canonical row for Settings: label on left, control on right, hairlines between rows.
// Uses only theme/roles.ts. RN primitives only. Minimum touch target 44px.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import { spacing, touchTarget, typeRoles } from '../../theme/roles';

export interface SettingsRowProps {
  label: string;
  description?: string;
  control: React.ReactNode;
  colorScheme?: 'light' | 'dark';
  hideBorder?: boolean;
}

export function SettingsRow({
  label,
  description,
  control,
  colorScheme,
  hideBorder = false,
}: SettingsRowProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  return (
    <View
      style={[
        styles.row,
        {
          borderBottomColor: colors.divider,
          borderBottomWidth: hideBorder ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={styles.labelCol}>
        <Text
          style={[styles.label, typeRoles.davosVoice, { color: colors.textPrimary }]}
          allowFontScaling={true}
        >
          {label}
        </Text>
        {description ? (
          <Text
            style={[styles.description, typeRoles.meta, { color: colors.textSecondary }]}
            allowFontScaling={true}
          >
            {description}
          </Text>
        ) : null}
      </View>
      <View style={styles.controlCol}>{control}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touchTarget.minTargetIos,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  labelCol: {
    flex: 1,
    gap: spacing.xxs,
  },
  label: {
    paddingHorizontal: spacing.none,
  },
  description: {
    paddingHorizontal: spacing.none,
  },
  controlCol: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
