// components/davos/SettingsSection.tsx
// Canonical container for Settings sections (PRD §12; AU29).
// Replaces cards and rounded containers with unboxed typographic sections.
// Uses only theme/roles.ts. RN primitives only.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, getTheme } from '../../theme';
import { spacing, typeRoles } from '../../theme/roles';

export interface SettingsSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  colorScheme?: 'light' | 'dark';
}

export function SettingsSection({
  title,
  description,
  children,
  colorScheme,
}: SettingsSectionProps) {
  const theme = useTheme();
  const colors = colorScheme ? getTheme(colorScheme).colors : theme.colors;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text
          style={[styles.title, typeRoles.heading, { color: colors.textPrimary }]}
          allowFontScaling={true}
        >
          {title}
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
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  header: {
    gap: spacing.xxs,
    paddingBottom: spacing.xxs,
  },
  title: {
    paddingHorizontal: spacing.none,
  },
  description: {
    paddingHorizontal: spacing.none,
  },
  content: {
    gap: spacing.none,
  },
});
