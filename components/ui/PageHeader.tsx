// components/ui/PageHeader.tsx
// Editorial page header used by the primary tab screens.
// Keeps the eyebrow / title / supporting line / actions rhythm identical across
// Overview, Journal, and Settings at every width.

import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { useTheme } from '../../theme';
import { Text } from './Text';

export interface PageHeaderProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function PageHeader({ title, eyebrow, subtitle, actions, style }: PageHeaderProps) {
  const { colors, spacing } = useTheme();

  return (
    <View
      style={[
        styles.container,
        {
          borderBottomColor: colors.borderSubtle,
          marginBottom: spacing.md,
          paddingBottom: spacing.sm,
        },
        style,
      ]}
    >
      <View style={styles.textColumn}>
        {eyebrow ? (
          <Text role="caption" variant="tertiary" style={styles.eyebrow}>
            {eyebrow}
          </Text>
        ) : null}
        <Text role="display" accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? (
          <Text role="body" variant="secondary" style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  subtitle: {
    marginTop: 6,
    lineHeight: 22,
    maxWidth: 620,
  },
  actions: {
    flexShrink: 0,
    paddingBottom: 2,
  },
});
